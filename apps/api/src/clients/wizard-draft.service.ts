import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

/** 草稿 JSON 体积上限，防止异常大 payload；约 1MB 字符量级。 */
const MAX_PAYLOAD_CHARS = 1_000_000;

/** 轻量探测：进页只问有没有草稿，不拉 payload。 */
export interface WizardDraftMeta {
  exists: true;
  updatedAt: string;
}

export interface WizardDraftView extends WizardDraftMeta {
  payload: Record<string, unknown>;
}

/**
 * 新增客户向导的服务端草稿：每用户 1 槽，与 Client 主数据完全解耦。
 * 不进客户列表、不触发证书；证件文件不持久化（选填）。
 */
@Injectable()
export class WizardDraftService {
  constructor(private readonly prisma: PrismaService) {}

  /** 仅元数据，供进页决定是否展示「复原」，避免无谓传输整份 JSON。 */
  async getMeta(user: AuthenticatedUser): Promise<WizardDraftMeta | null> {
    const draft = await this.prisma.clientWizardDraft.findUnique({
      where: { userId: user.id },
      select: { updatedAt: true },
    });
    if (!draft) return null;
    return { exists: true, updatedAt: draft.updatedAt.toISOString() };
  }

  async get(user: AuthenticatedUser): Promise<WizardDraftView | null> {
    const draft = await this.prisma.clientWizardDraft.findUnique({
      where: { userId: user.id },
    });
    if (!draft) return null;
    return {
      exists: true,
      updatedAt: draft.updatedAt.toISOString(),
      payload: this.asPayloadObject(draft.payload),
    };
  }

  /** 保存只回 updatedAt，调用方不需要把整份 payload 再传一遍。 */
  async save(user: AuthenticatedUser, payload: Record<string, unknown>): Promise<WizardDraftMeta> {
    this.assertPayloadSize(payload);
    const data = { payload: payload as Prisma.InputJsonValue };
    const draft = await this.prisma.clientWizardDraft.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return { exists: true, updatedAt: draft.updatedAt.toISOString() };
  }

  async remove(user: AuthenticatedUser): Promise<{ deleted: boolean }> {
    // deleteMany 幂等，避免先 SELECT 再 DELETE 的双查询
    const result = await this.prisma.clientWizardDraft.deleteMany({
      where: { userId: user.id },
    });
    return { deleted: result.count > 0 };
  }

  private assertPayloadSize(payload: Record<string, unknown>) {
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      throw new BadRequestException('payload 无法序列化');
    }
    if (serialized.length > MAX_PAYLOAD_CHARS) {
      throw new BadRequestException('草稿内容过大，请精简后再保存');
    }
  }

  private asPayloadObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
}
