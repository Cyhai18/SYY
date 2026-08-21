import { IsIn, Matches } from 'class-validator';
import type { SmsScene } from '../../sms/sms-code.service';

const SCENES: SmsScene[] = ['register', 'login', 'reset-password', 'bind-phone'];

export class SendCodeDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsIn(SCENES, { message: 'scene 不合法' })
  scene!: SmsScene;
}
