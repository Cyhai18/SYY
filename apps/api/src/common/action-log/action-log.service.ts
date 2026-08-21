import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContext } from '../context/request-context';

export interface RecordActionInput {
  userId?: string;
  action: string;
  detail?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * 业务审计日志：记录"谁在什么时候做了什么、结果如何"，写 MySQL 供后台查询。
 * 与应用运行日志（nestjs-pino）通过 requestId 关联，见 docs/auth-profile-plan.md 第 7 节。
 *
 * 审计日志写入失败不应影响主业务流程（如登录/注册已经成功，不能因为这里报错而让整个请求失败），
 * 因此这里内部吞掉异常并只记录一条运行日志，调用方无需 try/catch。
 */
@Injectable()
export class ActionLogService {
  private readonly logger = new Logger(ActionLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordActionInput): Promise<void> {
    const requestId = RequestContext.getRequestId();
    try {
      await this.prisma.actionLog.create({
        data: {
          userId: input.userId,
          action: input.action,
          detail: input.detail,
          ip: input.ip,
          userAgent: input.userAgent,
          requestId,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, requestId, action: input.action, userId: input.userId },
        'Failed to write ActionLog, business flow continues',
      );
    }
  }
}
