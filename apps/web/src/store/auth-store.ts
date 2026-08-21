import { create } from 'zustand';
import type { PublicUser } from '@funtax/shared';

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  /** 应用启动时静默 refresh 是否完成，避免路由守卫在校验完成前误判未登录。 */
  initialized: boolean;
  setAuth: (user: PublicUser, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  setInitialized: (initialized: boolean) => void;
  clear: () => void;
}

/** 全局登录态：Access Token 仅存内存（不持久化），刷新页面靠 /auth/refresh 从 Cookie 恢复。 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  initialized: false,
  setAuth: (user, accessToken) => set({ user, accessToken }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setInitialized: (initialized) => set({ initialized }),
  clear: () => set({ user: null, accessToken: null }),
}));
