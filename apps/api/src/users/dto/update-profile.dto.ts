import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** 修改基础资料：昵称、邮箱。手机号/密码走独立接口（需要验证码/旧密码校验）。 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '昵称不能为空' })
  @MaxLength(30, { message: '昵称最多 30 个字符' })
  nickname?: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}
