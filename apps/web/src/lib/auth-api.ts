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

/** 应用启动时静默调用一次，用 Cookie 里的 Refresh Token 尝试恢复登录态。 */
export async function bootstrapAuth(): Promise<void> {
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
