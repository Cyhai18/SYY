// 仅本地开发兜底；生产环境必须通过 .env 的 JWT_ACCESS_SECRET / JWT_REFRESH_SECRET 覆盖。
// 注意：dotenv 会把 `JWT_ACCESS_SECRET=`（空值）读成 "" 而不是 undefined，
// `??` 对空串不生效，需先 trim 再判断，否则 passport-jwt 会报
// "JwtStrategy requires a secret or key"。
const isProd = process.env.NODE_ENV === 'production';

function resolveSecret(envValue: string | undefined, fallback: string): string {
  const trimmed = envValue?.trim();
  return trimmed ? trimmed : fallback;
}

const accessSecret = resolveSecret(process.env.JWT_ACCESS_SECRET, 'dev-access-secret');
const refreshSecret = resolveSecret(process.env.JWT_REFRESH_SECRET, 'dev-refresh-secret');

if (isProd) {
  const hasAccess = Boolean(process.env.JWT_ACCESS_SECRET?.trim());
  const hasRefresh = Boolean(process.env.JWT_REFRESH_SECRET?.trim());
  if (!hasAccess || !hasRefresh) {
    throw new Error(
      '生产环境必须配置 JWT_ACCESS_SECRET 和 JWT_REFRESH_SECRET 环境变量，禁止使用默认密钥。',
    );
  }
}

export const JWT_ACCESS_SECRET = accessSecret;
export const JWT_REFRESH_SECRET = refreshSecret;
