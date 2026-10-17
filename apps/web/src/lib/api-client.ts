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

const REFRESH_LOCK_NAME = 'funtax-auth-refresh';

/** 实际发起 /auth/refresh 请求。真正的网络调用必须放在跨 Tab 锁里执行，
 *  这样当锁轮到当前 Tab 时，fetch 会自动带上当时最新的 Cookie（浏览器按请求时刻取 Cookie，
 *  不是 JS 发起调用那一刻缓存的值），从而天然吃到其它 Tab 已经转动过的新 Refresh Token。 */
async function doRefreshRequest(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

/**
 * 用 Cookie 里的 Refresh Token 换新的 Access Token。
 * - Tab 内去重：同一时间只发起一次请求（多个 401 并发/启动引导并发时复用同一个 Promise）。
 * - 跨 Tab 互斥：Refresh Token 是一次性轮换（用一次就失效），多个 Tab/Window 几乎同时刷新页面
 *   或各自的 Access Token 同时过期时，会并发带着同一个旧 Refresh Token 去换新 Token，
 *   先到的一方轮换成功，后到的一方会因为 Token 已被撤销而返回 401，导致那个 Tab 被误判为"登录过期"
 *   并跳转回登录页（即"刷新页面有概率回到登录页"的根因）。
 *   用 Web Locks API 把实际请求串行化：排队等锁时不会提前发出请求，轮到执行时才真正 fetch，
 *   此时 Cookie 已经是别的 Tab 刷新后的最新值，从而避免"旧 Token 被别人抢先用掉"的情况。
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  const run = () => doRefreshRequest().catch(() => null);
  // lib.dom 里 LockGrantedCallback<T> 的类型签名要求回调同步返回 T，但 Web Locks 规范
  // 实际上允许回调返回 Promise<T> 并会自动等待，这里用类型断言绕开过于保守的内置类型。
  const pending: Promise<string | null> =
    typeof navigator !== 'undefined' && navigator.locks
      ? (navigator.locks.request(
          REFRESH_LOCK_NAME,
          run as unknown as () => string | null,
        ) as unknown as Promise<string | null>)
      : run();
  refreshPromise = pending.finally(() => {
    refreshPromise = null;
  });
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
): Promise<{ blob: Blob; fileName: string | null; truncated: boolean }> {
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
  const truncated = response.headers.get('X-Export-Truncated') === 'true';
  return { blob: await response.blob(), fileName, truncated };
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
