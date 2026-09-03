import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLogService } from '../common/action-log/action-log.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import type { ClientPayloadDto } from './dto/client-payload.dto';
import type { UpdateClientDto } from './dto/update-client.dto';
import type { ListClientsDto } from './dto/list-clients.dto';

/**
 * 客户画像落库入口。`createClient` 是单条录入向导与未来批量导入**共用**的唯一入口，
 * 字段校验之外的业务逻辑（expiresAt 计算、ActionLog 审计）只在这里写一份。
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actionLogService: ActionLogService,
  ) {}

  /** @param actor 创建者；ctx.ownerId 缺省时默认归属创建者本人 */
  async createClient(
    payload: ClientPayloadDto,
    actor: AuthenticatedUser,
    meta: RequestMeta,
    ownerId?: string,
  ) {
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

    return this.findOne(client.id, actor);
  }

  async findAll(query: ListClientsDto, actor: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(actor.role === Role.USER ? { ownerId: actor.id } : {}),
      ...(query.clientType ? { clientType: query.clientType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { phone: { contains: query.keyword } },
              { companyInfo: { nameCn: { contains: query.keyword } } },
              { companyInfo: { nameEn: { contains: query.keyword } } },
              { companyInfo: { creditCode: { contains: query.keyword } } },
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
          owner: true,
          agentInfos: { include: { shops: { select: { id: true } } } },
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
        nameCn: c.companyInfo?.nameCn ?? null,
        nameEn: c.companyInfo?.nameEn ?? null,
        ownerId: c.ownerId,
        ownerNickname: c.owner.nickname,
        shopCount: c.agentInfos.reduce((sum, a) => sum + a.shops.length, 0),
        createdAt: c.createdAt.toISOString(),
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
