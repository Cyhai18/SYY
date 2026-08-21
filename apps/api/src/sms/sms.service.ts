import { Injectable, Logger } from '@nestjs/common';

/** 短信发送能力抽象，预留第三方接入点（阿里云/腾讯云，服务商待定）。 */
export interface SmsService {
  send(phone: string, code: string): Promise<void>;
}

export const SMS_SERVICE = Symbol('SMS_SERVICE');

/** MVP mock 实现：仅打日志，不真实发送。接入真实服务商前不要用于生产。 */
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
