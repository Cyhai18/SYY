import type { AuthResult, PublicUser, SmsScene } from '@funtax/shared';
import { apiClient, refreshAccessToken } from './api-client';
import { useAuthStore } from '../store/auth-store';

export const authApi = {
  sendCode: (phone: string, scene: SmsScene) =>
    apiClient.post<{ success: true }>(
      '/auth/sms-code',
      { phone, scene },
      { retryOnUnauthorized: false },
    ),

  register: (phone: string, code: string, password?: string) =>
    apiClient.post<AuthResult>(
      '/auth/register',
      { phone, code, password },
      { retryOnUnauthorized: false },
    ),

  login: (params: { phone: string; code?: string; password?: string }) =>
    apiClient.post<AuthResult>('/auth/login', params, { retryOnUnauthorized: false }),

  logout: () => apiClient.post<{ success: true }>('/auth/logout'),

  me: () => apiClient.get<PublicUser>('/users/me'),
};

let bootstrapPromise: Promise<void> | null = null;

/** 应用启动时静默调用一次，用 Cookie 里的 Refresh Token 尝试恢复登录态。
 *  用模块级 Promise 去重：同一时间内的重复调用（如 StrictMode 双调用、多组件挂载）复用同一次请求。
 *  实际换 Token 复用 `refreshAccessToken`（与 401 自动重试共用同一个跨 Tab 锁 + 单飞 Promise），
 *  避免这里再单独发一次 /auth/refresh，导致和另一条刷新路径并发踩踏同一枚一次性 Refresh Token。 */
export function bootstrapAuth(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = doBootstrapAuth().finally(() => {
      bootstrapPromise = null;
    });
  }
  return bootstrapPromise;
}

async function doBootstrapAuth(): Promise<void> {
  const { setAuth, clear, setInitialized } = useAuthStore.getState();
  try {
    const accessToken = await refreshAccessToken();
    if (!accessToken) throw new Error('refresh failed');
    useAuthStore.getState().setAccessToken(accessToken);
    const user = await authApi.me();
    setAuth(user, accessToken);
  } catch {
    clear();
  } finally {
    setInitialized(true);
  }
}
