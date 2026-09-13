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

/**
 * 从后端错误响应体里提取可展示的字符串消息。
 * `AllExceptionsFilter` 直接把 `exception.getResponse()` 塞进 `message` 字段：
 * Nest 内置异常（如 `new ConflictException('xxx')`）的 `getResponse()` 返回的是
 * `{ message, error, statusCode }` 对象而非字符串，所以这里的 `message` 可能是
 * 字符串 / 字符串数组（class-validator 校验失败）/ 嵌套对象，需要递归拆包，
 * 否则 `message.error(err.message)` 会显示成 `[object Object]`。
 */
function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map((p) => extractErrorMessage(p)).join('；');
  if (payload && typeof payload === 'object' && 'message' in payload) {
    return extractErrorMessage((payload as { message: unknown }).message);
  }
  return undefined;
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
    const message = extractErrorMessage(payload?.message);
    throw new ApiError(response.status, message ?? '请求失败', requestId);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** 提交 multipart/form-data（客户创建携带证件图片），不手动设置 Content-Type，交给浏览器带上 boundary。 */
async function requestMultipart<T>(
  path: string,
  formData: FormData,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<T> {
  const accessToken = useAuthStore.getState().accessToken;

  const doFetch = (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });

  let response = await doFetch(accessToken);

  if (response.status === 401) {
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
    const message = extractErrorMessage(payload?.message);
    throw new ApiError(response.status, message ?? '请求失败', requestId);
  }

  return (await response.json()) as T;
}

/** 下载二进制响应（如证书 PDF），复用 access token 与 401 自动刷新逻辑，但不按 JSON 解析响应体。 */
async function requestBinary(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<{ blob: Blob; fileName: string | null }> {
  const { method = 'POST', body } = options;
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

  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      useAuthStore.getState().setAccessToken(newToken);
      response = await doFetch(newToken);
    } else {
      useAuthStore.getState().clear();
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: '请求失败' }));
    const message = extractErrorMessage(payload?.message);
    throw new ApiError(response.status, message ?? '请求失败');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  // 优先取 RFC 5987 的 filename*=UTF-8''xxx（percent-encoded，能正确还原中文文件名）；
  // 服务端（Express res.download）在 filename* 之前还会附带一个 ASCII 兜底的 filename="..."
  // （中文场景下会被替换成 "?"），所以不能直接用第一个匹配到的 filename=。
  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  const asciiMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  const fileName = utf8Match
    ? decodeURIComponent(utf8Match[1])
    : asciiMatch
      ? decodeURIComponent(asciiMatch[1])
      : null;
  return { blob: await response.blob(), fileName };
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Partial<RequestOptions>) =>
    request<T>(path, { method: 'POST', body, ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  postBinary: (path: string, body?: unknown) => requestBinary(path, { method: 'POST', body }),
  getBinary: (path: string) => requestBinary(path, { method: 'GET' }),
  postMultipart: <T>(path: string, formData: FormData) =>
    requestMultipart<T>(path, formData, 'POST'),
  patchMultipart: <T>(path: string, formData: FormData) =>
    requestMultipart<T>(path, formData, 'PATCH'),
};

export type { AuthResult };
