import { Module } from '@nestjs/common';
import { SmsCodeService } from './sms-code.service';
import { MockSmsService, SMS_SERVICE } from './sms.service';

@Module({
  providers: [SmsCodeService, { provide: SMS_SERVICE, useClass: MockSmsService }],
  exports: [SmsCodeService],
})
export class SmsModule {}
