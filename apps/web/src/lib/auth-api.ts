import type { AuthResult, PublicUser, SmsScene } from '@funtax/shared';
import { apiClient } from './api-client';
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
 *  用模块级 Promise 去重：同一时间内的重复调用（如 StrictMode 双调用、多组件挂载）复用同一次请求，
 *  避免并发 /auth/refresh 因 Refresh Token 一次性轮换而互相踩踏，导致刚登录就被清空登录态。 */
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
    const { accessToken } = await apiClient.post<{ accessToken: string }>(
      '/auth/refresh',
      undefined,
      { retryOnUnauthorized: false },
    );
    useAuthStore.getState().setAccessToken(accessToken);
    const user = await authApi.me();
    setAuth(user, accessToken);
  } catch {
    clear();
  } finally {
    setInitialized(true);
  }
}
