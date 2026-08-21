// 仅本地开发兜底；生产环境必须通过 .env 的 JWT_ACCESS_SECRET / JWT_REFRESH_SECRET 覆盖。
const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  throw new Error(
    '生产环境必须配置 JWT_ACCESS_SECRET 和 JWT_REFRESH_SECRET 环境变量，禁止使用默认密钥。',
  );
}

export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret';
