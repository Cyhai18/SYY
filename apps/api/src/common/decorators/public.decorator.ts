import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记免登录接口，配合全局 JwtAuthGuard 使用（默认鉴权，显式放行）。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
