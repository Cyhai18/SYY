import type { AuthResult } from '@funtax/shared';
import { useAuthStore } from '../store/auth-store';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

let refreshPromise: Promise<string | null> | null = null;

/** 用 Cookie 里的 Refresh Token 换新的 Access Token；同一时间只发起一次请求（多个 401 并发时复用）。 */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken: string };
        return data.accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** 401 时是否尝试自动 refresh 重试一次，默认 true。刷新接口自身需传 false 避免死循环。 */
  retryOnUnauthorized?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, retryOnUnauthorized = true } = options;
  const accessToken = useAuthStore.getState().accessToken;

  const doFetch = (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let response = await doFetch(accessToken);

  if (response.status === 401 && retryOnUnauthorized) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      useAuthStore.getState().setAccessToken(newToken);
      response = await doFetch(newToken);
    } else {
      useAuthStore.getState().clear();
    }
  }

  const requestId = response.headers.get('X-Request-Id') ?? undefined;

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().clear();
    }
    const payload = await response.json().catch(() => ({ message: '请求失败' }));
    const message = Array.isArray(payload?.message) ? payload.message.join('；') : payload?.message;
    throw new ApiError(response.status, message ?? '请求失败', requestId);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Partial<RequestOptions>) =>
    request<T>(path, { method: 'POST', body, ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
};

export type { AuthResult };
