import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttachmentType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLogService } from '../common/action-log/action-log.service';
import { FILE_STORAGE, type FileStorageService } from '../storage/file-storage.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import type {
  AgentInfoDto,
  AppendAgentInfoDto,
  ClientPayloadDto,
  ShopDto,
} from './dto/client-payload.dto';
import type { UpdateClientDto } from './dto/update-client.dto';
import type { ListClientsDto } from './dto/list-clients.dto';

export interface ClientAttachmentInput {
  type: AttachmentType;
  buffer: Buffer;
  mimetype: string;
  originalName: string;
}

/**
 * 客户画像落库入口。`createClient` 是单条录入向导与批量导入**共用**的唯一入口，
 * 字段校验之外的业务逻辑（expiresAt 计算、附件落盘、ActionLog 审计）只在这里写一份。
 */
@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionLogService: ActionLogService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorageService,
  ) {}

  /**
   * 按注册类型选取去重键查重：公司类型用统一信用代码，个人类型用身份证号，
   * 两者都落在 `CompanyInfo.creditCode`（见 schema.prisma 注释）。
   * 见 docs/client-batch-import-design.md 第 8 节。
   *
   * 仅供服务端内部使用（`createClient` 建档前硬阻断查重），带出完整 `companyInfo`/`legalRepInfo`。
   * 面向前端 onBlur 触发的查重请使用 `checkDuplicate`，其只返回展示所需的最小字段以避免信息泄露。
   */
  async findDuplicate(creditCode: string) {
    return this.prisma.client.findFirst({
      where: { deletedAt: null, companyInfo: { creditCode } },
      include: {
        companyInfo: true,
        legalRepInfo: true,
        agentInfos: { include: { shops: { include: { products: true } } } },
      },
    });
  }

  /**
   * 供向导 onBlur 触发的实时查重使用（未登录态也可能高频触发，不做 `assertAccess` 权限拦截——
   * 命中的客户可能归属别的员工，业务上允许"发现老客户要追加新代理信息"的员工后续加入该客户的
   * 跟踪名单，见 `appendAgentInfo`）。
   *
   * 但正因为不做权限拦截，这里刻意**只返回展示代理信息卡片所需的最小字段**（国家/代理公司/店铺/
   * 产品数量），不包含 `companyInfo`/`legalRepInfo` 等公司名称、法人身份证等敏感信息，避免任意登录
   * 用户靠试统一信用代码/身份证号撞库窥探他人客户的完整资料。未命中返回 `null`。
   */
  async checkDuplicate(creditCode: string) {
    const client = await this.prisma.client.findFirst({
      where: { deletedAt: null, companyInfo: { creditCode } },
      select: {
        id: true,
        agentInfos: {
          select: {
            country: true,
            agentCompany: true,
            shops: {
              select: {
                platform: true,
                shopName: true,
                // 只需数量用于展示，避免把每个店铺下的产品 id 列表都传回前端
                _count: { select: { products: true } },
              },
            },
          },
        },
      },
    });
    if (!client) return null;
    return {
      id: client.id,
      agentInfos: client.agentInfos.map((agent) => ({
        country: agent.country,
        agentCompany: agent.agentCompany,
        shops: agent.shops.map((shop) => ({
          platform: shop.platform,
          shopName: shop.shopName,
          productCount: shop._count.products,
        })),
      })),
    };
  }

  /**
   * @param actor 创建者；ownerId 缺省时默认归属创建者本人
   * @param attachments 营业执照/身份证图片，事务提交后落盘，落盘失败只记 warning，不回滚客户创建
   */
  async createClient(
    payload: ClientPayloadDto,
    actor: AuthenticatedUser,
    meta: RequestMeta,
    ownerId?: string,
    attachments?: ClientAttachmentInput[],
  ) {
    const duplicate = await this.findDuplicate(payload.companyInfo.creditCode);
    if (duplicate) {
      throw new ConflictException(
        `该客户已存在（${duplicate.companyInfo?.nameCn ?? duplicate.companyInfo?.nameEn ?? duplicate.phone}），请勿重复创建`,
      );
    }
    // 公司类型客户不再采集法人信息，改为在"主体信息"中必填联系人；个人类型客户仍需完整的法人信息
    if (payload.clientType === 'COMPANY' && !payload.companyInfo.contactPerson) {
      throw new BadRequestException('联系人不能为空');
    }
    if (payload.clientType === 'INDIVIDUAL' && !payload.legalRepInfo) {
      throw new BadRequestException('法人信息不能为空');
    }
    const client = await this.prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          clientType: payload.clientType,
          phone: payload.phone,
          email: payload.email,
          remark: payload.remark,
          ownerId: ownerId ?? actor.id,
          createdById: actor.id,
          updatedById: actor.id,
          companyInfo: { create: payload.companyInfo },
          legalRepInfo: payload.legalRepInfo ? { create: payload.legalRepInfo } : undefined,
          agentInfos: {
            create: payload.agentInfos.map((agent) => ({
              ...buildAgentInfoScalars(agent),
              // 建档时尚未拿到 client.id，Shop/Product 的 clientId 冗余字段先占位，事务内下方 updateMany 回填
              shops: buildShopsCreateInput(agent.shops, ''),
            })),
          },
        },
        include: { agentInfos: { include: { shops: { include: { products: true } } } } },
      });

      // Shop/Product 冗余 clientId 需在拿到 client.id 后回填（嵌套 create 时尚不知道 id）
      const shopIds = created.agentInfos.flatMap((a) => a.shops.map((s) => s.id));
      await tx.shop.updateMany({
        where: { id: { in: shopIds } },
        data: { clientId: created.id },
      });
      await tx.product.updateMany({
        where: { shopId: { in: shopIds } },
        data: { clientId: created.id },
      });

      return created;
    });

    await this.actionLogService.record({
      userId: actor.id,
      action: 'CREATE_CLIENT',
      detail: JSON.stringify({ clientId: client.id, phone: payload.phone }),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // 附件落盘发生在事务提交之后：先保证客户核心数据落库，图片写盘失败只记 warning，不回滚客户创建
    // （见 docs/client-batch-import-design.md 第 5.2 节）。单条录入向导与批量导入共用这一段逻辑。
    if (attachments?.length) {
      await this.saveAttachments(client.id, attachments);
    }

    return this.findOne(client.id, actor);
  }

  private async saveAttachments(clientId: string, attachments: ClientAttachmentInput[]) {
    for (const attachment of attachments) {
      try {
        const { fileUrl } = await this.fileStorage.save({
          clientId,
          type: attachment.type,
          buffer: attachment.buffer,
          mimetype: attachment.mimetype,
          originalName: attachment.originalName,
        });
        await this.prisma.attachment.create({
          data: { clientId, type: attachment.type, fileUrl },
        });
      } catch (err) {
        this.logger.warn(
          `附件落盘失败，不影响客户创建：clientId=${clientId} type=${attachment.type} err=${String(err)}`,
        );
      }
    }
  }

  async findAll(query: ListClientsDto, actor: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(actor.role === Role.USER ? { ownerId: actor.id } : {}),
      ...(query.clientType ? { clientType: query.clientType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.agentCountry ? { agentInfos: { some: { country: query.agentCountry } } } : {}),
      ...(query.submittedFrom || query.submittedTo
        ? {
            createdAt: {
              ...(query.submittedFrom ? { gte: new Date(query.submittedFrom) } : {}),
              // 结束日期按当天 23:59:59.999 计算，保证区间含边界当天
              ...(query.submittedTo ? { lte: new Date(`${query.submittedTo}T23:59:59.999`) } : {}),
            },
          }
        : {}),
      ...(query.keyword
        ? {
            // 客户名称搜索：企业客户匹配公司中英文名，个人客户匹配法人姓名（中文）/拼音
            OR: [
              { companyInfo: { nameCn: { contains: query.keyword } } },
              { companyInfo: { nameEn: { contains: query.keyword } } },
              { legalRepInfo: { nameCn: { contains: query.keyword } } },
              { legalRepInfo: { namePinyin: { contains: query.keyword } } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        include: {
          companyInfo: true,
          legalRepInfo: true,
          owner: true,
          agentInfos: {
            include: { shops: { select: { id: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((c) => ({
        id: c.id,
        clientType: c.clientType,
        phone: c.phone,
        email: c.email,
        status: c.status,
        nameCn: c.companyInfo?.nameCn ?? c.legalRepInfo?.nameCn ?? null,
        nameEn: c.companyInfo?.nameEn ?? c.legalRepInfo?.namePinyin ?? null,
        ownerId: c.ownerId,
        ownerNickname: c.owner.nickname,
        shopCount: c.agentInfos.reduce((sum, a) => sum + a.shops.length, 0),
        createdAt: c.createdAt.toISOString(),
        agentInfos: c.agentInfos.map((a) => ({
          id: a.id,
          country: a.country,
          agentCompany: a.agentCompany,
          expectedEffectiveDate: a.expectedEffectiveDate.toISOString(),
          expiresAt: a.expiresAt.toISOString(),
          shopCount: a.shops.length,
        })),
      })),
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const client = await this.prisma.client.findFirst({
      where: { id, deletedAt: null },
      include: {
        companyInfo: true,
        legalRepInfo: true,
        agentInfos: { include: { shops: { include: { products: true } } } },
        attachments: true,
      },
    });
    if (!client) {
      throw new NotFoundException('客户不存在');
    }
    await this.assertAccess(client.id, client.ownerId, actor);
    return client;
  }

  async update(id: string, dto: UpdateClientDto, actor: AuthenticatedUser, meta: RequestMeta) {
    const existing = await this.findOne(id, actor);
    // 统一信用代码/身份证号是客户唯一标识，一旦客户存在即不可通过编辑接口变更，见 stripImmutableIdentifiers。
    const { companyInfo, legalRepInfo } = stripImmutableIdentifiers(
      dto.companyInfo,
      dto.legalRepInfo,
    );
    await this.prisma.client.update({
      where: { id },
      data: {
        email: dto.email,
        remark: dto.remark,
        updatedById: actor.id,
        companyInfo: companyInfo ? { update: companyInfo } : undefined,
        legalRepInfo: legalRepInfo ? { update: legalRepInfo } : undefined,
      },
    });
    await this.actionLogService.record({
      userId: actor.id,
      action: 'UPDATE_CLIENT',
      detail: JSON.stringify({ clientId: id }),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.findOne(existing.id, actor);
  }

  /**
   * 老客户追加代理信息（见 docs/client-profile-design.md）：
   * - 统一信用代码/身份证号锁定不可变更（`stripImmutableIdentifiers` 落库前剔除）；
   * - 主体信息/法人信息其余字段、以及本次新上传的证件图片按最新一次为准覆盖；
   * - 新增的 (country, agentCompany) 组合不能与已有的重复，也不能在本次提交内部重复；
   * - 操作人自动加入该客户的 `trackers`，实现"一个客户可由多个员工共同跟踪"。
   */
  async appendAgentInfo(
    clientId: string,
    payload: AppendAgentInfoDto,
    actor: AuthenticatedUser,
    meta: RequestMeta,
    attachments?: ClientAttachmentInput[],
  ) {
    const existing = await this.prisma.client.findFirst({
      where: { id: clientId, deletedAt: null },
      include: { companyInfo: true, legalRepInfo: true, agentInfos: true },
    });
    if (!existing) {
      throw new NotFoundException('客户不存在');
    }

    if (existing.clientType === 'COMPANY' && !payload.companyInfo.contactPerson) {
      throw new BadRequestException('联系人不能为空');
    }
    if (existing.clientType === 'INDIVIDUAL' && !payload.legalRepInfo) {
      throw new BadRequestException('法人信息不能为空');
    }

    const existingCombos = new Set(
      existing.agentInfos.map((a) => `${a.country}:${a.agentCompany}`),
    );
    const seenCombos = new Set<string>();
    for (const agent of payload.agentInfos) {
      const combo = `${agent.country}:${agent.agentCompany}`;
      if (existingCombos.has(combo) || seenCombos.has(combo)) {
        throw new ConflictException(
          `该客户已存在【${agent.country} - ${agent.agentCompany}】的代理信息，请勿重复添加`,
        );
      }
      seenCombos.add(combo);
    }

    const { companyInfo, legalRepInfo } = stripImmutableIdentifiers(
      payload.companyInfo,
      payload.legalRepInfo,
    );

    const client = await this.prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: clientId },
        data: {
          email: payload.email,
          remark: payload.remark,
          updatedById: actor.id,
          companyInfo: companyInfo ? { update: companyInfo } : undefined,
          legalRepInfo: legalRepInfo ? { update: legalRepInfo } : undefined,
          // 追加代理信息的操作人自动成为该客户的跟踪人之一，已在名单内则原样跳过
          trackers: {
            upsert: {
              where: { clientId_userId: { clientId, userId: actor.id } },
              create: { userId: actor.id },
              update: {},
            },
          },
        },
      });

      for (const agent of payload.agentInfos) {
        await tx.agentInfo.create({
          data: {
            clientId,
            ...buildAgentInfoScalars(agent),
            shops: buildShopsCreateInput(agent.shops, clientId),
          },
        });
      }

      return tx.client.findUniqueOrThrow({ where: { id: clientId } });
    });

    await this.actionLogService.record({
      userId: actor.id,
      action: 'APPEND_AGENT_INFO',
      detail: JSON.stringify({
        clientId: client.id,
        agentInfos: payload.agentInfos.map((a) => ({
          country: a.country,
          agentCompany: a.agentCompany,
        })),
      }),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (attachments?.length) {
      await this.saveAttachments(client.id, attachments);
    }

    return this.findOne(client.id, actor);
  }

  async softDelete(id: string, actor: AuthenticatedUser, meta: RequestMeta) {
    const existing = await this.findOne(id, actor);
    await this.prisma.client.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), updatedById: actor.id },
    });
    await this.actionLogService.record({
      userId: actor.id,
      action: 'DELETE_CLIENT',
      detail: JSON.stringify({ clientId: id }),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { success: true as const };
  }

  /**
   * 权限模型：ADMIN/SUPERADMIN 可访问所有客户；普通员工（USER）需是该客户的 owner（主负责人）
   * 或 trackers 名单内的跟踪人之一——一个客户允许被多个员工共同跟踪（见 ClientTracker 模型）。
   */
  private async assertAccess(clientId: string, ownerId: string, actor: AuthenticatedUser) {
    if (actor.role !== Role.USER || ownerId === actor.id) {
      return;
    }
    const tracker = await this.prisma.clientTracker.findUnique({
      where: { clientId_userId: { clientId, userId: actor.id } },
    });
    if (!tracker) {
      throw new ForbiddenException('无权访问该客户');
    }
  }
}

/**
 * 统一信用代码 / 身份证号是客户唯一标识，一旦客户存在即不可通过编辑类接口变更，
 * 落库前统一在此剔除，避免任何调用方（单条编辑、追加代理信息）不慎覆盖唯一标识。
 */
function stripImmutableIdentifiers<
  C extends { creditCode: string } | undefined,
  L extends { idNumber: string } | undefined,
>(companyInfo: C, legalRepInfo: L) {
  const { creditCode: _creditCode, ...companyRest } = companyInfo ?? {};
  const { idNumber: _idNumber, ...legalRepRest } = legalRepInfo ?? {};
  return {
    companyInfo: companyInfo ? companyRest : undefined,
    legalRepInfo: legalRepInfo ? legalRepRest : undefined,
  };
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/** `AgentInfo` 除 clientId/shops 外的标量字段，`createClient`/`appendAgentInfo` 共用，避免 expiresAt 计算逻辑重复。 */
function buildAgentInfoScalars(agent: AgentInfoDto) {
  return {
    country: agent.country,
    agentCompany: agent.agentCompany,
    agentYears: agent.agentYears,
    expectedEffectiveDate: new Date(agent.expectedEffectiveDate),
    expiresAt: addYears(new Date(agent.expectedEffectiveDate), agent.agentYears),
  };
}

/**
 * 构造 `AgentInfo.shops` 的嵌套 create 输入；`clientId` 是 Shop/Product 上的冗余字段，
 * `createClient` 建档阶段尚未拿到真正的 client.id，先传空字符串占位，事务内后续 updateMany 回填。
 */
function buildShopsCreateInput(shops: ShopDto[] | undefined, clientId: string) {
  if (!shops) return undefined;
  return {
    create: shops.map((shop) => ({
      platform: shop.platform,
      shopId: shop.shopId,
      shopName: shop.shopName,
      shopUrl: shop.shopUrl,
      brandNames: shop.brandNames,
      mainCategoryEn: shop.mainCategoryEn,
      clientId,
      products: shop.products
        ? { create: shop.products.map((p) => ({ ...p, clientId })) }
        : undefined,
    })),
  };
}
