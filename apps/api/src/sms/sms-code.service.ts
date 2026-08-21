import { BadRequestException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { SMS_SERVICE, type SmsService } from './sms.service';

export type SmsScene = 'register' | 'login' | 'reset-password' | 'bind-phone';

interface CodeEntry {
  code: string;
  expiresAt: number;
  lastSentAt: number;
  attempts: number;
}

const CODE_TTL_MS = 60 * 1000; // 1 分钟有效期
const RESEND_INTERVAL_MS = 60 * 1000; // 60s 一次
const MAX_VERIFY_ATTEMPTS = 5; // 单个验证码最多尝试 5 次，防暴力猜测
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 定期清理已过期但从未被验证/删除的条目，防止内存泄漏

/**
 * 验证码业务逻辑：生成、频控、校验。当前用内存 Map 存储（单实例可用），
 * 后续多实例部署需换成 Redis，接口保持不变（见 docs/auth-profile-plan.md）。
 *
 * 注意：如果用户请求了验证码但从未验证（如放弃注册），条目不会被 verify() 主动清除，
 * 因此需要一个后台定时器扫描并清理过期条目，避免 Map 无限增长。
 */
@Injectable()
export class SmsCodeService implements OnModuleDestroy {
  private readonly store = new Map<string, CodeEntry>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(@Inject(SMS_SERVICE) private readonly smsService: SmsService) {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private key(scene: SmsScene, phone: string): string {
    return `${scene}:${phone}`;
  }

  async sendCode(scene: SmsScene, phone: string): Promise<void> {
    const key = this.key(scene, phone);
    const existing = this.store.get(key);
    const now = Date.now();
    if (existing && now - existing.lastSentAt < RESEND_INTERVAL_MS) {
      throw new BadRequestException('发送过于频繁，请稍后再试');
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.store.set(key, { code, expiresAt: now + CODE_TTL_MS, lastSentAt: now, attempts: 0 });
    await this.smsService.send(phone, code);
  }

  verify(scene: SmsScene, phone: string, code: string): void {
    const key = this.key(scene, phone);
    const entry = this.store.get(key);
    if (!entry) {
      throw new BadRequestException('请先获取验证码');
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      throw new BadRequestException('验证码已过期，请重新获取');
    }
    if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
      this.store.delete(key);
      throw new BadRequestException('验证码错误次数过多，请重新获取');
    }
    if (entry.code !== code) {
      entry.attempts += 1;
      throw new BadRequestException('验证码错误');
    }
    this.store.delete(key); // 验证码一次性使用
  }
}
