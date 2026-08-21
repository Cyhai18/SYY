import { IsOptional, IsString, Matches } from 'class-validator';

export class LoginDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: '验证码格式不正确' })
  code?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
