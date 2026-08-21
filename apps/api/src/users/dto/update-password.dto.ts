import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * 修改密码：已设置过密码的用户需提供 oldPassword 校验；
 * 从未设置过密码（仅验证码登录）的用户首次设置时可不提供 oldPassword。
 */
export class UpdatePasswordDto {
  @IsOptional()
  @IsString()
  oldPassword?: string;

  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  newPassword!: string;
}
