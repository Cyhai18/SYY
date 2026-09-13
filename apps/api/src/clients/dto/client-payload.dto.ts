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
import { AgentCompany, AgentCountry, ClientType, Platform } from '@prisma/client';

/**
 * 单条录入向导提交 与 批量导入行 共用的校验结构（对应 `@funtax/shared` 的 `ClientPayload`）。
 * 所有增删改统一走 `ClientsService.createClient()`，此 DTO 是唯一入口的数据契约。
 */
export class CompanyInfoDto {
  /** 仅展示用途，不再作为查重/唯一性键，见 Client.uniqueIdentifier */
  @IsOptional() @IsString() @MaxLength(64) creditCode?: string;

  @IsOptional() @IsString() @MaxLength(200) nameCn?: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() addressCn?: string;
  @IsOptional() @IsString() @MaxLength(100) provinceEn?: string;
  @IsOptional() @IsString() @MaxLength(100) cityEn?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsString() addressEn?: string;
  /** 联系人，仅公司类型客户必填；是否必填由 ClientsService 按 clientType 校验 */
  @IsOptional() @IsString() @MaxLength(100) contactPerson?: string;
}

export class LegalRepresentativeDto {
  @IsString() @MinLength(1) @MaxLength(100) nameCn!: string;
  @IsString() @MinLength(1) @MaxLength(100) namePinyin!: string;
  @IsString() @MinLength(1) @MaxLength(64) idNumber!: string;
  @IsString() @MinLength(1) idAddressCn!: string;
  @IsOptional() @IsString() @MaxLength(20) idPostalCode?: string;
  @IsOptional() @IsString() idAddressEn?: string;
}

export class ProductDto {
  @IsEnum(Platform, { message: '平台不合法' }) platform!: Platform;
  @IsOptional() @IsString() @MaxLength(200) productNameCn?: string;
  @IsOptional() @IsString() @MaxLength(200) productNameEn?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsString() @MaxLength(100) asinOrSku?: string;
  @IsOptional() @IsString() productUrl?: string;
  @IsOptional() @IsBoolean() hasBattery?: boolean;
}

export class ShopDto {
  @IsEnum(Platform, { message: '平台不合法' }) platform!: Platform;
  @IsOptional() @IsString() @MaxLength(100) shopId?: string;
  @IsString() @MinLength(1) @MaxLength(200) shopName!: string;
  @IsString() @MinLength(1) shopUrl!: string;
  @IsString() @MinLength(1) brandNames!: string;
  @IsString() @MinLength(1) @MaxLength(200) mainCategoryEn!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDto)
  products?: ProductDto[];
}

export class AgentInfoDto {
  @IsEnum(AgentCountry, { message: '代理国家不合法' }) country!: AgentCountry;
  @IsDateString({}, { message: '生效日期格式不正确' }) expectedEffectiveDate!: string;
  @IsInt() @Min(1) @Max(20) agentYears!: number;
  @IsEnum(AgentCompany, { message: '代理公司不合法' }) agentCompany!: AgentCompany;

  /** 每条代理信息下至少要有一条店铺，与页面 AgentInfoEditor 的强制校验保持一致 */
  @IsArray()
  @ArrayMinSize(1, { message: '每条代理信息下至少需要一条店铺信息' })
  @ValidateNested({ each: true })
  @Type(() => ShopDto)
  shops!: ShopDto[];
}

export class ClientPayloadDto {
  @IsEnum(ClientType, { message: '注册类型不合法' }) clientType!: ClientType;

  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' }) phone!: string;

  @IsEmail({}, { message: '邮箱格式不正确' }) email!: string;

  @IsOptional() @IsString() remark?: string;

  /** 客户唯一标识：公司存统一社会信用代码，个人存身份证号，落在 Client.uniqueIdentifier */
  @IsString()
  @MinLength(1, { message: '统一信用代码/身份证号不能为空' })
  @MaxLength(64)
  uniqueIdentifier!: string;

  @ValidateNested() @Type(() => CompanyInfoDto) companyInfo!: CompanyInfoDto;

  /** 公司类型客户不再采集法人信息，仅个人类型客户必填；是否必填由 ClientsService 按 clientType 校验 */
  @IsOptional()
  @ValidateNested()
  @Type(() => LegalRepresentativeDto)
  legalRepInfo?: LegalRepresentativeDto;

  @IsArray()
  @ArrayMinSize(1, { message: '至少需要一条代理信息' })
  @ValidateNested({ each: true })
  @Type(() => AgentInfoDto)
  agentInfos!: AgentInfoDto[];
}

/**
 * 已存在客户追加代理信息（见 docs/client-profile-design.md「老客户追加代理信息」一节）。
 * `Client.uniqueIdentifier` 是客户唯一标识，一旦客户存在即不可变更，
 * `ClientsService.appendAgentInfo()` 落库时不会更新该字段，只更新其余主体/法人信息。
 */
export class AppendAgentInfoDto {
  @IsOptional() @IsEmail({}, { message: '邮箱格式不正确' }) email?: string;

  @IsOptional() @IsString() remark?: string;

  @ValidateNested() @Type(() => CompanyInfoDto) companyInfo!: CompanyInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LegalRepresentativeDto)
  legalRepInfo?: LegalRepresentativeDto;

  @IsArray()
  @ArrayMinSize(1, { message: '至少需要新增一条代理信息' })
  @ValidateNested({ each: true })
  @Type(() => AgentInfoDto)
  agentInfos!: AgentInfoDto[];
}
