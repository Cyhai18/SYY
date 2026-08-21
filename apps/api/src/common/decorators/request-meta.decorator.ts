import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestMeta } from '../../auth/auth.service';

/** 从请求中提取 ip/userAgent，避免各 Controller 重复书写 `{ ip: req.ip, userAgent: ... }`。 */
export const ReqMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestMeta => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return { ip: request.ip, userAgent: request.headers['user-agent'] };
  },
);
