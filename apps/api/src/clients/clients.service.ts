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
import ExcelJS from 'exceljs';
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

/**
 * 证书服务有效期状态推导：与 packages/shared 的 `deriveCertificateServiceStatus` 保持同一口径
 * （apps/api 未依赖 @funtax/shared，按约定单独维护一份，见 row-validator.service.ts 同类注释）。
 * 到期前 30 天进入"待续费"窗口，过期后为"失效"，否则"生效中"。
 */
const CERTIFICATE_RENEWAL_WINDOW_DAYS = 30;
function deriveCertificateServiceStatus(expiresAt: Date): 'ACTIVE' | 'PENDING_RENEWAL' | 'EXPIRED' {
  const now = Date.now();
  const expiry = expiresAt.getTime();
  if (now > expiry) return 'EXPIRED';
  const renewalWindowStart = expiry - CERTIFICATE_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (now >= renewalWindowStart) return 'PENDING_RENEWAL';
  return 'ACTIVE';
}

// 中文标签，需与 @funtax/shared 的 *_LABELS 保持一致（apps/api 未依赖 @funtax/shared，按既有约定单独维护一份）。
const AGENT_COUNTRY_LABELS: Record<string, string> = {
  GB: '英国',
  EU: '欧盟',
  US: '美国',
  TR: '土耳其',
  CA: '加拿大',
};
const CERTIFICATE_PROCESS_STATUS_LABELS: Record<string, string> = {
  NONE: '未生成',
  PENDING: '等待生成',
  GENERATING: '生成中',
  FAILED: '生成失败',
};
const CERTIFICATE_SERVICE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '生效中',
  PENDING_RENEWAL: '待续费',
  EXPIRED: '失效',
};

/** 客户导出单次最多允许导出的客户数，超过时阻断并提示缩小筛选范围，避免单次查询/生成过大文件。 */
const EXPORT_MAX_CLIENTS = 5000;
const EXPORT_BATCH_SIZE = 500;

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
   * 因此该接口只会在 OCR 识别成功后触发一次，不再有 onBlur 高频触发的顾虑。
   *
   * 命中客户归属当前操作人（`ownerId === actor.id`）时，才返回完整的 `companyInfo`/`legalRepInfo`/
   * 联系方式/已有代理信息，供前端回填对应表单 tab、并禁用已存在的代理国家选项；
   * 命中客户归属其他用户时，视为越权操作，不返回任何客户信息（`client: null`），
   * 仅通过 `owned: false` 告知前端该客户已存在但不属于当前用户，前端据此阻断流程、不允许继续新增/修改。
   * 未命中返回 `{ exists: false, owned: false, client: null }`。
   */
  async checkDuplicate(uniqueIdentifier: string, actor: AuthenticatedUser) {
    const client = await this.prisma.client.findFirst({
      where: { deletedAt: null, uniqueIdentifier },
      select: {
        id: true,
        ownerId: true,
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
            shops: {
              select: {
                platform: true,
                shopId: true,
                shopName: true,
                shopUrl: true,
                brandNames: true,
                mainCategoryEn: true,
                products: {
                  select: {
                    platform: true,
                    productNameCn: true,
                    productNameEn: true,
                    category: true,
                    asinOrSku: true,
                    productUrl: true,
                    hasBattery: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!client) return { exists: false, owned: false, client: null };
    if (client.ownerId !== actor.id) {
      // 命中客户归属其他用户：不暴露任何客户信息，仅告知"存在但不属于我"，前端据此阻断新增/修改。
      return { exists: true, owned: false, client: null };
    }
    return {
      exists: true,
      owned: true,
      client: {
        id: client.id,
        phone: client.phone,
        email: client.email ?? undefined,
        remark: client.remark ?? undefined,
        companyInfo: client.companyInfo ?? undefined,
        legalRepInfo: client.legalRepInfo ?? undefined,
        // 命中后一并带出已有代理信息的完整店铺/产品明细，供前端在代理信息步骤只读展示、
        // 并在新增其他国家代理信息时默认复用；归属校验见上方 owned 判断。
        agentInfos: client.agentInfos.map((a) => ({
          country: a.country,
          agentCompany: a.agentCompany,
          expectedEffectiveDate: a.expectedEffectiveDate.toISOString(),
          agentYears: a.agentYears,
          shops: a.shops,
        })),
      },
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

  /**
   * 构建客户列表查询的 where 条件，供 `findAll` 与 `exportClients` 共用。
   * 返回外层 `ClientWhereInput` 以及对应的 `agentInfos` 子查询 where（用于 include 时只返回命中筛选的代理信息）。
   */
  private buildClientListWhere(
    query: Pick<
      ListClientsDto,
      | 'clientType'
      | 'certificateStatus'
      | 'agentCountry'
      | 'submittedFrom'
      | 'submittedTo'
      | 'keyword'
    >,
    actor: AuthenticatedUser,
  ): { where: Prisma.ClientWhereInput; agentInfosWhere: Prisma.AgentInfoWhereInput | undefined } {
    // 证书状态筛选：与列表页展示口径一致（见 deriveCertificateServiceStatus 同款函数），
    // NONE/PENDING/GENERATING/FAILED 直接匹配生成流程状态；ACTIVE/PENDING_RENEWAL/EXPIRED
    // 则是生成成功后按 expiresAt 与当前时间的相对关系换算出的日期区间。
    const certificateStatusWhere: Prisma.AgentInfoWhereInput | undefined = (() => {
      switch (query.certificateStatus) {
        case undefined:
          return undefined;
        case 'NONE':
        case 'PENDING':
        case 'GENERATING':
        case 'FAILED':
          return { certificateStatus: query.certificateStatus };
        case 'ACTIVE': {
          const now = new Date();
          const renewalStart = new Date(
            now.getTime() + CERTIFICATE_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
          );
          return { certificateStatus: 'SUCCESS', expiresAt: { gt: renewalStart } };
        }
        case 'PENDING_RENEWAL': {
          const now = new Date();
          const renewalStart = new Date(
            now.getTime() + CERTIFICATE_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
          );
          return { certificateStatus: 'SUCCESS', expiresAt: { gte: now, lte: renewalStart } };
        }
        case 'EXPIRED': {
          const now = new Date();
          return { certificateStatus: 'SUCCESS', expiresAt: { lt: now } };
        }
      }
    })();
    const agentInfosWhere: Prisma.AgentInfoWhereInput | undefined =
      certificateStatusWhere || query.agentCountry
        ? {
            ...certificateStatusWhere,
            ...(query.agentCountry ? { country: query.agentCountry } : {}),
          }
        : undefined;
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(actor.role === Role.USER ? { ownerId: actor.id } : {}),
      ...(query.clientType ? { clientType: query.clientType } : {}),
      // certificateStatus 和 agentCountry 都基于 agentInfos 做 some 过滤，需合并到同一个 agentInfos
      // 条件里（分开写成两个 `agentInfos` key 会被后一个覆盖，而不是同时生效）。
      ...(agentInfosWhere ? { agentInfos: { some: agentInfosWhere } } : {}),
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
    return { where, agentInfosWhere };
  }

  async findAll(query: ListClientsDto, actor: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { where, agentInfosWhere } = this.buildClientListWhere(query, actor);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        include: {
          companyInfo: true,
          legalRepInfo: true,
          owner: true,
          agentInfos: {
            // 按代理国家/证书状态筛选时，只返回匹配的代理信息，不展示该客户其余不匹配的代理信息
            // （否则客户是因为其中一条代理信息命中筛选条件才被查出来的，但子表格会连带展示该客户
            // 下所有代理信息，造成"搜待续费却看到生效中"的误解）。
            ...(agentInfosWhere ? { where: agentInfosWhere } : {}),
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
          agentYears: a.agentYears,
          shopCount: a.shops.length,
          certificateStatus: a.certificateStatus,
          certificateError: a.certificateError,
          serviceStatus:
            a.certificateStatus === 'SUCCESS' ? deriveCertificateServiceStatus(a.expiresAt) : null,
        })),
      })),
    };
  }

  /**
   * 导出客户列表为 Excel：按与 `findAll` 相同的筛选口径（含权限隔离）取数，每条代理信息导出一行，
   * 客户下没有代理信息时仍导出一行（代理相关列留空）。超过 `EXPORT_MAX_CLIENTS` 时阻断并提示缩小范围，
   * 不做静默截断。分批查询避免一次性把全部代理信息载入内存。
   */
  async exportClients(
    query: Pick<
      ListClientsDto,
      | 'clientType'
      | 'certificateStatus'
      | 'agentCountry'
      | 'submittedFrom'
      | 'submittedTo'
      | 'keyword'
    >,
    actor: AuthenticatedUser,
  ): Promise<Buffer> {
    const { where, agentInfosWhere } = this.buildClientListWhere(query, actor);

    const total = await this.prisma.client.count({ where });
    if (total > EXPORT_MAX_CLIENTS) {
      throw new BadRequestException(
        `当前筛选条件下共 ${total} 条，超过 ${EXPORT_MAX_CLIENTS} 条上限，请缩小筛选范围后重试`,
      );
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('客户列表');
    sheet.columns = [
      { header: '客户名称（中文）', key: 'nameCn', width: 30 },
      { header: '代理国家', key: 'agentCountry', width: 12 },
      { header: '服务截止日期', key: 'expiresAt', width: 14 },
      { header: '证书状态', key: 'certificateStatus', width: 12 },
    ];

    for (let skip = 0; skip < total; skip += EXPORT_BATCH_SIZE) {
      const clients = await this.prisma.client.findMany({
        where,
        include: {
          companyInfo: true,
          legalRepInfo: true,
          agentInfos: {
            ...(agentInfosWhere ? { where: agentInfosWhere } : {}),
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: EXPORT_BATCH_SIZE,
      });

      for (const c of clients) {
        const nameCn = c.companyInfo?.nameCn ?? c.legalRepInfo?.nameCn ?? '';
        if (c.agentInfos.length === 0) {
          sheet.addRow({ nameCn, agentCountry: '', expiresAt: '', certificateStatus: '' });
          continue;
        }
        for (const a of c.agentInfos) {
          const certificateStatusLabel =
            a.certificateStatus === 'SUCCESS'
              ? CERTIFICATE_SERVICE_STATUS_LABELS[deriveCertificateServiceStatus(a.expiresAt)]
              : CERTIFICATE_PROCESS_STATUS_LABELS[a.certificateStatus];
          sheet.addRow({
            nameCn,
            agentCountry: AGENT_COUNTRY_LABELS[a.country] ?? a.country,
            expiresAt: a.expiresAt.toISOString().slice(0, 10),
            certificateStatus: certificateStatusLabel,
          });
        }
      }
    }

    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
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
