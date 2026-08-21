import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  userId?: string;
}

/**
 * 贯穿单次请求生命周期的上下文，用 requestId 把「应用运行日志」与「业务审计日志（ActionLog）」串联起来。
 * 参见 docs/auth-profile-plan.md 第 7.2 节。
 */
export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  static run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  static get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  static getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  static getUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  static setUserId(userId: string): void {
    const store = this.storage.getStore();
    if (store) {
      store.userId = userId;
    }
  }
}
