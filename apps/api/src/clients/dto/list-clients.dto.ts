import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AgentCountry, ClientType } from '@prisma/client';

export class ListClientsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;

  /** 客户名称模糊搜索：中文名/英文名（企业取公司名称，个人取法人姓名/拼音） */
  @IsOptional() @IsString() keyword?: string;

  @IsOptional() @IsEnum(ClientType) clientType?: ClientType;

  /**
   * 证书状态筛选：NONE/PENDING/GENERATING/FAILED 对应生成流程状态（直接匹配 AgentInfo.certificateStatus）；
   * ACTIVE/PENDING_RENEWAL/EXPIRED 对应生成成功后按日期派生的服务状态，见 clients.service.ts#findAll 的日期区间换算。
   */
  @IsOptional()
  @IsIn(['NONE', 'PENDING', 'GENERATING', 'FAILED', 'ACTIVE', 'PENDING_RENEWAL', 'EXPIRED'])
  certificateStatus?:
    'NONE' | 'PENDING' | 'GENERATING' | 'FAILED' | 'ACTIVE' | 'PENDING_RENEWAL' | 'EXPIRED';

  @IsOptional() @IsEnum(AgentCountry) agentCountry?: AgentCountry;

  /** 提交日期区间（含边界），格式 YYYY-MM-DD */
  @IsOptional() @IsDateString() submittedFrom?: string;

  @IsOptional() @IsDateString() submittedTo?: string;
}
