import { Injectable, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestContext } from '../context/request-context';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

/**
 * 全局鉴权 Guard：默认所有接口都要求登录，`@Public()` 标记的接口放行。
 * 校验通过后把 userId 写入 RequestContext，供日志（应用日志 + ActionLog）关联使用。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException();
    }
    RequestContext.setUserId((user as unknown as AuthenticatedUser).id);
    return user;
  }
}
