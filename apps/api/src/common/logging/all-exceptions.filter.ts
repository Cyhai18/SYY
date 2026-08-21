import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../context/request-context';
import { ActionLogService } from '../action-log/action-log.service';

/**
 * 全局异常过滤器：统一记录 error 级运行日志（含堆栈），5xx 额外写一条 ActionLog(SYSTEM_ERROR)
 * 方便在后台"操作记录"里也能看到系统级失败。MVP 阶段不接 Sentry，仅本地结构化日志
 * （见 docs/auth-profile-plan.md 第 7.3/8 节，后续视需要再接入告警渠道）。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    private readonly actionLogService: ActionLogService,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    // 非 HttpException（未预期的运行时错误）不把原始 message/堆栈信息透传给客户端，
    // 避免泄露内部实现细节（数据库报错、第三方 SDK 报错等），详细信息只进运行日志。
    const message = isHttpException ? exception.getResponse() : 'Internal server error';

    const requestId = RequestContext.getRequestId();

    this.logger.error(
      { err: exception, requestId, path: request.url, method: request.method },
      'Unhandled exception',
    );

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      void this.actionLogService.record({
        userId: RequestContext.getUserId(),
        action: 'SYSTEM_ERROR',
        detail: `${request.method} ${request.url}: ${(exception as Error)?.message ?? 'unknown error'}`,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
