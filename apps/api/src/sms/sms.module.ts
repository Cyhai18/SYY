import { Logger, Module } from '@nestjs/common';
import { SmsCodeService } from './sms-code.service';
import { MockSmsService, SMS_SERVICE, type SmsService } from './sms.service';
import { TencentSmsService } from './tencent-sms.service';

const logger = new Logger('SmsModule');

/** 配置齐全才启用腾讯云短信，否则回退到仅打日志的 Mock 实现，避免本地开发必须配置短信密钥。 */
function isTencentSmsConfigured(): boolean {
  return Boolean(
    process.env.TENCENT_SMS_SECRET_ID &&
    process.env.TENCENT_SMS_SECRET_KEY &&
    process.env.TENCENT_SMS_SDK_APP_ID &&
    process.env.TENCENT_SMS_SIGN_NAME &&
    process.env.TENCENT_SMS_TEMPLATE_ID,
  );
}

@Module({
  providers: [
    SmsCodeService,
    TencentSmsService,
    MockSmsService,
    {
      provide: SMS_SERVICE,
      useFactory: (tencent: TencentSmsService, mock: MockSmsService): SmsService => {
        if (isTencentSmsConfigured()) {
          logger.log('已启用腾讯云短信服务');
          return tencent;
        }
        logger.warn('腾讯云短信未配置（TENCENT_SMS_*），回退到 Mock 短信服务，仅打日志不真实发送');
        return mock;
      },
      inject: [TencentSmsService, MockSmsService],
    },
  ],
  exports: [SmsCodeService],
})
export class SmsModule {}
