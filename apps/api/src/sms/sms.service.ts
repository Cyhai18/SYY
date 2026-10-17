import { Injectable, Logger } from '@nestjs/common';

/**
 * 短信发送能力抽象。真实实现见 `TencentSmsService`（腾讯云短信），
 * 未配置腾讯云密钥时由 `SmsModule` 自动回退到下面的 Mock 实现。
 */
export interface SmsService {
  send(phone: string, code: string): Promise<void>;
}

export const SMS_SERVICE = Symbol('SMS_SERVICE');

/** 兜底 mock 实现：仅打日志，不真实发送。未配置 TENCENT_SMS_* 环境变量时启用，不要用于生产。 */
@Injectable()
export class MockSmsService implements SmsService {
  private readonly logger = new Logger(MockSmsService.name);

  async send(phone: string, code: string): Promise<void> {
    this.logger.warn(
      `[MOCK SMS] 发送验证码到 ${phone}：${code}（1 分钟内有效，仅日志模拟，未真实发送）`,
    );
    await Promise.resolve();
  }
}
