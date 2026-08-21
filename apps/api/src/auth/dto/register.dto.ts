import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @Matches(/^\d{6}$/, { message: '验证码格式不正确' })
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  password?: string;
}
