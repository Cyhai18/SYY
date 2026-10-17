import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgentCompany } from '@prisma/client';
import { CompanyInfoDto, LegalRepresentativeDto, ShopDto } from './client-payload.dto';

/**
 * 编辑客户：基础字段 + 公司信息/法人信息整体替换。
 * 店铺/产品/代理信息结构较复杂，编辑场景暂不支持在此接口内增删，后续如需要单独开店铺子资源接口。
 */
export class UpdateClientDto {
  @IsOptional() @IsEmail({}, { message: '邮箱格式不正确' }) email?: string;

  @IsOptional() @IsString() remark?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyInfoDto)
  companyInfo?: CompanyInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LegalRepresentativeDto)
  legalRepInfo?: LegalRepresentativeDto;
}

/**
 * 编辑代理信息：代理国家（country）锁定不可变更，见 AgentInfo.@@unique([clientId, country, agentCompany])。
 * 代理公司允许变更（部分国家支持多个代理公司可选），年限/生效日期变更后由服务层重算截止日期。
 * 店铺/产品整体替换（先删后建），与新建向导的数据结构保持一致，不支持增量增删单条店铺。
 */
export class UpdateAgentInfoDto {
  @IsDateString({}, { message: '生效日期格式不正确' }) expectedEffectiveDate!: string;
  @IsInt() @Min(1) @Max(20) agentYears!: number;
  @IsEnum(AgentCompany, { message: '代理公司不合法' }) agentCompany!: AgentCompany;

  @IsArray()
  @ArrayMinSize(1, { message: '每条代理信息下至少需要一条店铺信息' })
  @ValidateNested({ each: true })
  @Type(() => ShopDto)
  shops!: ShopDto[];
}
