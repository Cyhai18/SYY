import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttachmentType, ClientStatus, Prisma, Role } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLogService } from '../common/action-log/action-log.service';
import { FILE_STORAGE, type FileStorageService } from '../storage/file-storage.service';
import {
  CERTIFICATE_GENERATE_QUEUE,
  type CertificateGenerateJobData,
} from '../queue/queue.constants';
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
    @Inject(CERTIFICATE_GENERATE_QUEUE)
    private readonly certificateQueue: Queue<CertificateGenerateJobData>,
  ) {}

  /**
   * 建档/追加代理信息成功后，对指定的 agentInfoIds 逐条置 `certificateStatus = PENDING` 并入队，
   * 交由 `CertificateProcessor`（BullMQ Worker）后台生成证书；不阻塞客户创建主流程，
   * 入队失败只记 warning（见 docs/certificate-generation-design.md 异步生成方案）。
   */
  private async enqueueCertificateGeneration(agentInfoIds: string[], actorId: string) {
    if (!agentInfoIds.length) return;
    try {
      await this.prisma.agentInfo.updateMany({
        where: { id: { in: agentInfoIds } },
        data: { certificateStatus: 'PENDING', certificateError: null },
      });
      await Promise.all(
        agentInfoIds.map((agentInfoId) =>
          this.certificateQueue.add('generate', { agentInfoId, actorId }),
        ),
      );
    } catch (err) {
      this.logger.warn(`证书生成入队失败，不影响客户创建：err=${String(err)}`);
    }
  }

  /**
   * 主体信息/法人信息中，除 DTO 已声明必填的字段外，按 clientType 额外要求必填的字段。
   * 公司类型：公司中文名、公司英文名、公司中文地址、公司英文地址、邮编（联系人已在调用处单独校验）；
   * 个人类型：身份证地址（英文）、邮编。
   */
  private assertRequiredFields(
    clientType: 'COMPANY' | 'INDIVIDUAL',
    companyInfo: {
      nameCn?: string;
      nameEn?: string;
      addressCn?: string;
      addressEn?: string;
      postalCode?: string;
    },
    legalRepInfo?: { idAddressEn?: string; idPostalCode?: string },
  ) {
    if (clientType === 'COMPANY') {
      if (!companyInfo.nameCn) throw new BadRequestException('公司中文名不能为空');
      if (!companyInfo.nameEn) throw new BadRequestException('公司英文名不能为空');
      if (!companyInfo.addressCn) throw new BadRequestException('公司中文地址不能为空');
      if (!companyInfo.addressEn) throw new BadRequestException('公司英文地址不能为空');
      if (!companyInfo.postalCode) throw new BadRequestException('邮编不能为空');
    }
    if (clientType === 'INDIVIDUAL') {
      if (!legalRepInfo?.idAddressEn) throw new BadRequestException('身份证地址（英文）不能为空');
      if (!legalRepInfo?.idPostalCode) throw new BadRequestException('邮编不能为空');
    }
  }

  /**
   * 按客户唯一标识（`Client.uniqueIdentifier`：公司存统一信用代码，个人存身份证号）查重。
   * 见 docs/client-batch-import-design.md 第 8 节。
   *
   * 仅供服务端内部使用（`createClient` 建档前硬阻断查重），带出完整 `companyInfo`/`legalRepInfo`。
   * 面向前端 onBlur 触发的查重请使用 `checkDuplicate`，其只返回展示所需的最小字段以避免信息泄露。
   */
  async findDuplicate(uniqueIdentifier: string) {
    return this.prisma.client.findFirst({
      where: { deletedAt: null, uniqueIdentifier },
      include: {
        companyInfo: true,
        legalRepInfo: true,
        agentInfos: { include: { shops: { include: { products: true } } } },
      },
    });
  }

  /**
   * 供向导查重使用：统一信用代码/身份证号两个输入框已禁止手动编辑，只能由证件 OCR 识别得出，
   * 因此该接口只会在 OCR 识别成功后触发一次，不再有 onBlur 高频触发的顾虑，故不做 `assertAccess`
   * 权限拦截，直接返回命中客户的完整 `companyInfo`/`legalRepInfo`/联系方式/已有代理信息，供前端
   * 回填对应表单 tab、并禁用已存在的代理国家选项，避免用户已上传过证件的老客户还要重新手填一遍，
   * 或不小心为同一国家重复追加代理信息。未命中返回 `null`。
   */
  async checkDuplicate(uniqueIdentifier: string) {
    const client = await this.prisma.client.findFirst({
      where: { deletedAt: null, uniqueIdentifier },
      select: {
        id: true,
        phone: true,
        email: true,
        remark: true,
        companyInfo: {
          select: {
            creditCode: true,
            nameCn: true,
            nameEn: true,
            addressCn: true,
            provinceEn: true,
            cityEn: true,
            postalCode: true,
            addressEn: true,
            contactPerson: true,
          },
        },
        legalRepInfo: {
          select: {
            nameCn: true,
            namePinyin: true,
            idNumber: true,
            idAddressCn: true,
            idPostalCode: true,
            idAddressEn: true,
          },
        },
        agentInfos: {
          select: {
            country: true,
            agentCompany: true,
            expectedEffectiveDate: true,
            agentYears: true,
          },
        },
      },
    });
    if (!client) return null;
    return {
      id: client.id,
      phone: client.phone,
      email: client.email ?? undefined,
      remark: client.remark ?? undefined,
      companyInfo: client.companyInfo ?? undefined,
      legalRepInfo: client.legalRepInfo ?? undefined,
      agentInfos: client.agentInfos.map((a) => ({
        country: a.country,
        agentCompany: a.agentCompany,
        expectedEffectiveDate: a.expectedEffectiveDate.toISOString(),
        agentYears: a.agentYears,
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
    status?: ClientStatus,
  ) {
    const duplicate = await this.findDuplicate(payload.uniqueIdentifier);
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
    this.assertRequiredFields(payload.clientType, payload.companyInfo, payload.legalRepInfo);
    const client = await this.prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          clientType: payload.clientType,
          phone: payload.phone,
          email: payload.email,
          remark: payload.remark,
          uniqueIdentifier: payload.uniqueIdentifier,
          status,
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

    // 建档提交的全部代理信息都是新增的，成功入库后统一触发后台生成证书。
    await this.enqueueCertificateGeneration(
      client.agentInfos.map((a) => a.id),
      actor.id,
    );

    return this.findOne(client.id, actor);
  }

  /**
   * 每个客户每种证件类型只保留最新一份（`Attachment` 已加 `@@unique([clientId, type])`）：
   * 重新上传时 upsert 覆盖旧记录，DB 提交成功后再删除旧物理文件（删除失败只记 warning，不回滚）。
   */
  private async saveAttachments(clientId: string, attachments: ClientAttachmentInput[]) {
    for (const attachment of attachments) {
      try {
        const existing = await this.prisma.attachment.findUnique({
          where: { clientId_type: { clientId, type: attachment.type } },
        });
        const { fileUrl } = await this.fileStorage.save({
          clientId,
          type: attachment.type,
          buffer: attachment.buffer,
          mimetype: attachment.mimetype,
          originalName: attachment.originalName,
        });
        await this.prisma.attachment.upsert({
          where: { clientId_type: { clientId, type: attachment.type } },
          update: { fileUrl },
          create: { clientId, type: attachment.type, fileUrl },
        });
        if (existing && existing.fileUrl !== fileUrl) {
          await this.fileStorage.delete(existing.fileUrl);
        }
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
            // 按代理国家筛选时，只返回匹配该国家的代理信息，不展示该客户的其他国家代理
            ...(query.agentCountry ? { where: { country: query.agentCountry } } : {}),
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
          certificateStatus: a.certificateStatus,
          certificateError: a.certificateError,
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
    // Client.uniqueIdentifier 是客户唯一标识，一旦客户存在即不可通过编辑接口变更；
    // companyInfo.creditCode/legalRepInfo.idNumber 已降级为仅展示字段，可随其余信息一并更新。
    await this.prisma.client.update({
      where: { id },
      data: {
        email: dto.email,
        remark: dto.remark,
        updatedById: actor.id,
        companyInfo: dto.companyInfo ? { update: dto.companyInfo } : undefined,
        legalRepInfo: dto.legalRepInfo ? { update: dto.legalRepInfo } : undefined,
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
    this.assertRequiredFields(existing.clientType, payload.companyInfo, payload.legalRepInfo);

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

    const { client, newAgentInfoIds } = await this.prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: clientId },
        data: {
          email: payload.email,
          remark: payload.remark,
          updatedById: actor.id,
          companyInfo: payload.companyInfo ? { update: payload.companyInfo } : undefined,
          legalRepInfo: payload.legalRepInfo ? { update: payload.legalRepInfo } : undefined,
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

      const newAgentInfoIds: string[] = [];
      for (const agent of payload.agentInfos) {
        const created = await tx.agentInfo.create({
          data: {
            clientId,
            ...buildAgentInfoScalars(agent),
            shops: buildShopsCreateInput(agent.shops, clientId),
          },
        });
        newAgentInfoIds.push(created.id);
      }

      return {
        client: await tx.client.findUniqueOrThrow({ where: { id: clientId } }),
        newAgentInfoIds,
      };
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

    // APPEND 模式只对本次新增的代理信息触发生成，老的代理信息不受影响。
    await this.enqueueCertificateGeneration(newAgentInfoIds, actor.id);

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
