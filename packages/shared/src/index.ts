export const APP_NAME = '税驿云';

export const API_PREFIX = '/api';

export type HealthStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  timestamp: string;
}

export const createHealthResponse = (service: string): HealthResponse => ({
  status: 'ok',
  service,
  timestamp: new Date().toISOString(),
});

/** 与 Prisma `Role` 枚举保持一致，供前端展示角色名等场景使用。 */
export type Role = 'USER' | 'ADMIN' | 'SUPERADMIN';

export const ROLE_LABELS: Record<Role, string> = {
  USER: '普通用户',
  ADMIN: '管理员',
  SUPERADMIN: '超级管理员',
};

/** 登录/注册/`/users/me` 等接口返回的用户信息（不含敏感字段）。 */
export interface PublicUser {
  id: string;
  phone: string;
  email: string | null;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
}

/** 登录/注册接口成功响应体（Refresh Token 走 HttpOnly Cookie，不在响应体中）。 */
export interface AuthResult {
  user: PublicUser;
  accessToken: string;
}

export type SmsScene = 'register' | 'login' | 'reset-password' | 'bind-phone';
