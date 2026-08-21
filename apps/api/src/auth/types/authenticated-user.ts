import type { Role } from '@prisma/client';

/** JwtStrategy.validate() 返回并挂到 req.user 上的最小用户信息。 */
export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: Role;
}
