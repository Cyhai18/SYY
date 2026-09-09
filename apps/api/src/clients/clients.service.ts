import {
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
import type { ClientPayloadDto } from './dto/client-payload.dto';
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
   */
  async findDuplicate(creditCode: string) {
    return this.prisma.client.findFirst({
      where: { deletedAt: null, companyInfo: { creditCode } },
      include: { companyInfo: true, legalRepInfo: true },
    });
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
          legalRepInfo: { create: payload.legalRepInfo },
          agentInfos: {
            create: payload.agentInfos.map((agent) => ({
              country: agent.country,
              agentCompany: agent.agentCompany,
              agentYears: agent.agentYears,
              expectedEffectiveDate: new Date(agent.expectedEffectiveDate),
              expiresAt: addYears(new Date(agent.expectedEffectiveDate), agent.agentYears),
              shops: agent.shops
                ? {
                    create: agent.shops.map((shop) => ({
                      platform: shop.platform,
                      shopId: shop.shopId,
                      shopName: shop.shopName,
                      shopUrl: shop.shopUrl,
                      brandNames: shop.brandNames,
                      mainCategoryEn: shop.mainCategoryEn,
                      clientId: '',
                      products: shop.products
                        ? { create: shop.products.map((p) => ({ ...p, clientId: '' })) }
                        : undefined,
                    })),
                  }
                : undefined,
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
    this.assertAccess(client.ownerId, actor);
    return client;
  }

  async update(id: string, dto: UpdateClientDto, actor: AuthenticatedUser, meta: RequestMeta) {
    const existing = await this.findOne(id, actor);
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

  private assertAccess(ownerId: string, actor: AuthenticatedUser) {
    if (actor.role === Role.USER && ownerId !== actor.id) {
      throw new ForbiddenException('无权访问该客户');
    }
  }
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}
