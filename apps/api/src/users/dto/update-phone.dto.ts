import { Matches } from 'class-validator';

/** 换绑手机号：新手机号 + 发到新手机号的验证码（scene='bind-phone'）。 */
export class UpdatePhoneDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @Matches(/^\d{6}$/, { message: '验证码格式不正确' })
  code!: string;
}
