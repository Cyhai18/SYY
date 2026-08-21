import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** 声明接口允许的角色，配合 RolesGuard 使用，为后续权限系统预留扩展位。 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
