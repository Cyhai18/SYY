import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AgentCountry, ClientType, Platform } from '@prisma/client';

/**
 * 单条录入向导提交 与 批量导入行 共用的校验结构（对应 `@funtax/shared` 的 `ClientPayload`）。
 * 所有增删改统一走 `ClientsService.createClient()`，此 DTO 是唯一入口的数据契约。
 */
export class CompanyInfoDto {
  @IsString()
  @MinLength(1, { message: '统一信用代码/身份证号不能为空' })
  @MaxLength(64)
  creditCode!: string;

  @IsOptional() @IsString() @MaxLength(200) nameCn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() addressCn?: string;
  @IsOptional() @IsString() @MaxLength(100) provinceEn?: string;
  @IsOptional() @IsString() @MaxLength(100) cityEn?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsString() addressEn?: string;
}

export class LegalRepresentativeDto {
  @IsString() @MinLength(1) @MaxLength(100) nameCn!: string;
  @IsString() @MinLength(1) @MaxLength(100) surnamePinyin!: string;
  @IsString() @MinLength(1) @MaxLength(100) givenNamePinyin!: string;
  @IsString() @MinLength(1) @MaxLength(64) idNumber!: string;
  @IsString() @MinLength(1) idAddress!: string;
}

export class ProductDto {
  @IsEnum(Platform, { message: '平台不合法' }) platform!: Platform;
  @IsString() @MinLength(1) @MaxLength(200) productName!: string;
  @IsString() @MinLength(1) @MaxLength(100) category!: string;
  @IsString() @MinLength(1) @MaxLength(100) asinOrSku!: string;
  @IsString() @MinLength(1) productUrl!: string;
  @IsOptional() @IsBoolean() hasBattery?: boolean;
}

export class AgentInfoDto {
  @IsEnum(AgentCountry, { message: '代理国家不合法' }) country!: AgentCountry;
  @IsDateString({}, { message: '生效日期格式不正确' }) expectedEffectiveDate!: string;
  @IsInt() @Min(1) @Max(20) agentYears!: number;
  @IsString() @MinLength(1) @MaxLength(200) agentCompany!: string;
}

export class ShopDto {
  @IsEnum(Platform, { message: '平台不合法' }) platform!: Platform;
  @IsString() @MinLength(1) @MaxLength(200) shopName!: string;
  @IsString() @MinLength(1) shopUrl!: string;
  @IsString() @MinLength(1) brandNames!: string;
  @IsString() @MinLength(1) @MaxLength(200) mainCategoryEn!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDto)
  products?: ProductDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentInfoDto)
  agentInfos?: AgentInfoDto[];
}

export class ClientPayloadDto {
  @IsEnum(ClientType, { message: '注册类型不合法' }) clientType!: ClientType;

  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' }) phone!: string;

  @IsOptional() @IsEmail({}, { message: '邮箱格式不正确' }) email?: string;

  @IsOptional() @IsString() remark?: string;

  @ValidateNested() @Type(() => CompanyInfoDto) companyInfo!: CompanyInfoDto;

  @ValidateNested() @Type(() => LegalRepresentativeDto) legalRepInfo!: LegalRepresentativeDto;

  @IsArray()
  @ArrayMinSize(1, { message: '至少需要一个店铺' })
  @ValidateNested({ each: true })
  @Type(() => ShopDto)
  shops!: ShopDto[];
}
