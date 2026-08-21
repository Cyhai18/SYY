import { createHash } from 'node:crypto';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Refresh Token 落库前先哈希，DB 里不存明文（泄库也无法直接冒用）。 */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
