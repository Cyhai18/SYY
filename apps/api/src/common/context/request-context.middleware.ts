import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { RequestContext } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 64;
// 仅允许字母、数字、连字符、下划线，避免日志注入或写入奇怪字符到 ActionLog.requestId。
const SAFE_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * 为每个请求生成/透传 requestId，写入 AsyncLocalStorage 上下文，并回写到响应头，
 * 便于前端报错时携带 X-Request-Id 供后端按此排查（见 docs/auth-profile-plan.md 第 7.2 节）。
 * 客户端传入的值会做长度/字符校验，不合法则忽略并自动生成，防止日志注入或索引膨胀。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId =
      candidate &&
      candidate.length <= MAX_REQUEST_ID_LENGTH &&
      SAFE_REQUEST_ID_PATTERN.test(candidate)
        ? candidate
        : nanoid();
    res.setHeader('X-Request-Id', requestId);
    RequestContext.run({ requestId }, () => next());
  }
}
