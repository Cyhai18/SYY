import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CompanyInfoDto, LegalRepresentativeDto } from './client-payload.dto';

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
