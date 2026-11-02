import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 客户列表「录入账户」下拉：支持关键词搜索 + 分页，适配用户量大的场景。 */
export class ListUserOptionsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;

  /** 按昵称或手机号模糊匹配 */
  @IsOptional() @IsString() @MaxLength(50) keyword?: string;
}
