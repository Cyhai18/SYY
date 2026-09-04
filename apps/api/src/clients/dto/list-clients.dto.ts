import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AgentCountry, ClientStatus, ClientType } from '@prisma/client';

export class ListClientsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;

  /** 客户名称模糊搜索：中文名/英文名（企业取公司名称，个人取法人姓名/拼音） */
  @IsOptional() @IsString() keyword?: string;

  @IsOptional() @IsEnum(ClientType) clientType?: ClientType;

  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;

  @IsOptional() @IsEnum(AgentCountry) agentCountry?: AgentCountry;

  /** 提交日期区间（含边界），格式 YYYY-MM-DD */
  @IsOptional() @IsDateString() submittedFrom?: string;

  @IsOptional() @IsDateString() submittedTo?: string;
}
