import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgentCompany, AgentCountry, ClientType, Platform } from '@prisma/client';
import { ClientsService } from '../clients.service';
import { OcrService } from '../../ocr/ocr.service';
import { ClientPayloadDto } from '../dto/client-payload.dto';
import type { ParsedExcelResult } from './excel-parser.service';

export interface ReviewIssue {
  field: string;
  message: string;
}

export interface ValidateResult {
  /** 校验通过时为完整的候选 payload，可直接传给 ClientsService.createClient */
  payload?: ClientPayloadDto;
  /** 无论通过与否，都是最新的字段快照，供 NEEDS_REVIEW 时前端核对表单回填 */
  reviewFields: Record<string, unknown>;
  issues: ReviewIssue[];
  valid: boolean;
}

// 中文标签 -> Prisma 枚举值，需与 packages/shared/src/index.ts 的 *_LABELS 保持一致
// （apps/api 未依赖 @funtax/shared，避免引入跨包模块解析问题，此处按枚举值单独维护一份）。
const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  COMPANY: '企业',
  INDIVIDUAL: '个人',
};

const PLATFORM_LABELS: Record<Platform, string> = {
  AMAZON: 'Amazon',
  TEMU: 'Temu',
  SHEIN: 'Shein',
  TIKTOK: 'TikTok',
  ALIEXPRESS: '速卖通',
  ALIBABA_ICBU: '阿里国际站',
  FRUUGO: 'Fruugo',
  OTHER: '其他',
};

const AGENT_COUNTRY_LABELS: Record<AgentCountry, string> = {
  GB: '英国',
  EU: '欧盟',
  US: '美国',
  TR: '土耳其',
  CA: '加拿大',
};

const AGENT_COMPANY_LABELS: Record<AgentCompany, string> = {
  OVERSEA_WALKERS_GB: 'OVERSEA WALKERS LIMITED',
  OVERSEA_WALKERS_EU: 'Oversea Walkers',
  EU_CONSULTEN_SRLS: 'EU Consulten Srls',
  OVERSEA_WALKERS_US: 'Oversea Walkers LLC',
  OVERSEA_WALKERS_TR: 'OVERSEAWALKERS DANISMANLIK LiMiTED SiRKETi',
  OVERSEA_WALKERS_CA: 'Oversea Walkers',
};

/** 代理公司所属国家，用于在 Excel 模板下拉框里给同名/易混淆的公司加国家后缀做区分，见 AGENT_COMPANY_LABELS_WITH_COUNTRY */
const AGENT_COMPANY_COUNTRY: Record<AgentCompany, AgentCountry> = {
  OVERSEA_WALKERS_GB: 'GB',
  OVERSEA_WALKERS_EU: 'EU',
  EU_CONSULTEN_SRLS: 'EU',
  OVERSEA_WALKERS_US: 'US',
  OVERSEA_WALKERS_TR: 'TR',
  OVERSEA_WALKERS_CA: 'CA',
};

/** 代理公司下拉框展示用文案：公司全称 + "（国家）" 后缀，Excel 模板与人工核对表单据此展示，导入时按后缀反查 */
const AGENT_COMPANY_LABELS_WITH_COUNTRY: Record<AgentCompany, string> = Object.fromEntries(
  (Object.keys(AGENT_COMPANY_LABELS) as AgentCompany[]).map((key) => [
    key,
    `${AGENT_COMPANY_LABELS[key]}（${AGENT_COUNTRY_LABELS[AGENT_COMPANY_COUNTRY[key]]}）`,
  ]),
) as Record<AgentCompany, string>;

/** 反查 label -> enum value，找不到时返回 undefined（交由后续 class-validator 判定为必填缺失/不合法） */
function reverseLabel<T extends string>(labels: Record<T, string>, value?: string): T | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const entry = (Object.entries(labels) as Array<[T, string]>).find(
    ([, label]) => label === trimmed,
  );
  return entry?.[0];
}

/** 代理公司专用反查：兼容带国家后缀（"公司全称（国家）"，Excel 下拉框展示格式）与不带后缀两种填法 */
function reverseAgentCompany(value?: string): AgentCompany | undefined {
  return (
    reverseLabel(AGENT_COMPANY_LABELS_WITH_COUNTRY, value) ??
    reverseLabel(AGENT_COMPANY_LABELS, value)
  );
}

/**
 * 合并 Excel 文字字段 + OCR 识别字段，翻译中文枚举标签为内部值，
 * 复用 `ClientPayloadDto` 的 class-validator 规则做统一校验，产出候选 payload 与问题清单。
 * 见 docs/client-batch-import-design.md 第 6.2/6.3 节。
 */
@Injectable()
export class RowValidatorService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly ocrService: OcrService,
  ) {}

  async validate(parsed: ParsedExcelResult): Promise<ValidateResult> {
    const issues: ReviewIssue[] = [];

    const [businessLicenseOcr, idCardFrontOcr] = await Promise.all([
      parsed.images.businessLicense
        ? this.ocrService.recognizeBusinessLicense({
            originalname: 'business-license',
            buffer: parsed.images.businessLicense.buffer,
            mimetype: parsed.images.businessLicense.mimetype,
          })
        : undefined,
      parsed.images.idCardFront
        ? this.ocrService.recognizeIdCard(
            {
              originalname: 'id-card-front',
              buffer: parsed.images.idCardFront.buffer,
              mimetype: parsed.images.idCardFront.mimetype,
            },
            'front',
          )
        : undefined,
    ]);

    if (parsed.images.businessLicense && !businessLicenseOcr?.recognized) {
      issues.push({ field: 'companyInfo', message: '营业执照识别置信度低，请核对公司信息' });
    }
    if (parsed.images.idCardFront && !idCardFrontOcr?.recognized) {
      issues.push({ field: 'legalRepInfo', message: '身份证识别置信度低，请核对法人信息' });
    }

    const companyInfo = {
      creditCode: parsed.companyInfo.creditCode || businessLicenseOcr?.fields.creditCode,
      nameCn: parsed.companyInfo.nameCn || businessLicenseOcr?.fields.nameCn,
      nameEn: parsed.companyInfo.nameEn || businessLicenseOcr?.fields.nameEn,
      addressCn: parsed.companyInfo.addressCn || businessLicenseOcr?.fields.addressCn,
      addressEn: parsed.companyInfo.addressEn || businessLicenseOcr?.fields.addressEn,
      provinceEn: parsed.companyInfo.provinceEn || businessLicenseOcr?.fields.provinceEn,
      cityEn: parsed.companyInfo.cityEn || businessLicenseOcr?.fields.cityEn,
      postalCode: parsed.companyInfo.postalCode || businessLicenseOcr?.fields.postalCode,
      contactPerson: parsed.contactPerson,
    };

    const legalRepInfo = {
      nameCn: parsed.legalRepInfo.nameCn || idCardFrontOcr?.fields.nameCn,
      namePinyin: parsed.legalRepInfo.namePinyin || idCardFrontOcr?.fields.namePinyin,
      idNumber: parsed.legalRepInfo.idNumber || idCardFrontOcr?.fields.idNumber,
      idAddressCn: parsed.legalRepInfo.idAddressCn || idCardFrontOcr?.fields.idAddressCn,
      idAddressEn: parsed.legalRepInfo.idAddressEn || idCardFrontOcr?.fields.idAddressEn,
      idPostalCode: parsed.legalRepInfo.idPostalCode || idCardFrontOcr?.fields.idPostalCode,
    };

    const resolvedClientType = reverseLabel(CLIENT_TYPE_LABELS, parsed.clientType);
    // Client.uniqueIdentifier：公司类型取信用代码，个人类型取身份证号，与页面向导提交逻辑保持一致
    const uniqueIdentifier =
      resolvedClientType === 'INDIVIDUAL' ? legalRepInfo.idNumber : companyInfo.creditCode;

    const candidate = {
      clientType: resolvedClientType,
      phone: parsed.phone,
      email: parsed.email,
      remark: parsed.remark,
      uniqueIdentifier,
      // 公司信息/法人信息只在对应注册类型下才校验：与页面新增客户向导一致，企业类型不采集法人信息，
      // 个人类型不采集公司信息。此前无条件都塞进 candidate，导致 legalRepInfo 的必填字段
      // （nameCn/namePinyin/idNumber/idAddressCn）在企业类型下也被 class-validator 强制校验。
      companyInfo: resolvedClientType === 'COMPANY' ? companyInfo : undefined,
      legalRepInfo: resolvedClientType === 'INDIVIDUAL' ? legalRepInfo : undefined,
      agentInfos: parsed.agentInfos.map((agent) => ({
        country: reverseLabel(AGENT_COUNTRY_LABELS, agent.country),
        agentCompany: reverseAgentCompany(agent.agentCompany),
        expectedEffectiveDate: agent.expectedEffectiveDate,
        agentYears: agent.agentYears,
        shops: agent.shops.map((shop) => ({
          platform: reverseLabel(PLATFORM_LABELS, shop.platform),
          shopId: shop.shopId,
          shopName: shop.shopName,
          shopUrl: shop.shopUrl,
          brandNames: shop.brandNames,
          mainCategoryEn: shop.mainCategoryEn,
          products: shop.products.map((product) => ({
            platform: reverseLabel(PLATFORM_LABELS, product.platform),
            productNameCn: product.productNameCn,
            productNameEn: product.productNameEn,
            category: product.category,
            asinOrSku: product.asinOrSku,
            productUrl: product.productUrl,
            hasBattery: product.hasBattery,
          })),
        })),
      })),
    };

    // 图片/联系人是否必填取决于注册类型：企业类型营业执照图片+联系人必填，身份证正反面选填；
    // 个人类型身份证正反面必填，营业执照图片+联系人选填。与页面新增客户表单的必填规则保持一致。
    if (candidate.clientType === 'COMPANY') {
      const info = candidate.companyInfo!;
      if (!parsed.images.businessLicense) {
        issues.push({ field: 'images.businessLicense', message: '企业类型必须上传营业执照图片' });
      }
      if (!info.contactPerson) {
        issues.push({ field: 'companyInfo.contactPerson', message: '企业类型必须填写联系人' });
      }
      // 与 ClientsService.assertRequiredFields 保持一致：这些字段在 DTO 上标记为选填（OCR 识别产出），
      // 但企业类型客户实际创建时是硬性必填，提前在此校验，避免"预览通过"但落库时才报错。
      if (!info.nameCn) {
        issues.push({ field: 'companyInfo.nameCn', message: '公司中文名不能为空' });
      }
      if (!info.nameEn) {
        issues.push({ field: 'companyInfo.nameEn', message: '公司英文名不能为空' });
      }
      if (!info.addressCn) {
        issues.push({ field: 'companyInfo.addressCn', message: '公司中文地址不能为空' });
      }
      if (!info.addressEn) {
        issues.push({ field: 'companyInfo.addressEn', message: '公司英文地址不能为空' });
      }
      if (!info.postalCode) {
        issues.push({ field: 'companyInfo.postalCode', message: '邮编不能为空' });
      }
    } else if (candidate.clientType === 'INDIVIDUAL') {
      const info = candidate.legalRepInfo!;
      if (!parsed.images.idCardFront) {
        issues.push({ field: 'images.idCardFront', message: '个人类型必须上传身份证正面图片' });
      }
      if (!parsed.images.idCardBack) {
        issues.push({ field: 'images.idCardBack', message: '个人类型必须上传身份证反面图片' });
      }
      // 同上，与 ClientsService.assertRequiredFields 的个人类型必填规则保持一致
      if (!info.idAddressEn) {
        issues.push({ field: 'legalRepInfo.idAddressEn', message: '身份证地址（英文）不能为空' });
      }
      if (!info.idPostalCode) {
        issues.push({ field: 'legalRepInfo.idPostalCode', message: '邮编不能为空' });
      }
    }

    // 代理信息与页面新增客户向导保持一致的额外业务规则（class-validator 无法表达的跨字段/结构性约束）：
    // 1）代理公司必须与代理国家匹配（页面下拉框按国家过滤选项，导入走文字反查需要显式校验，见
    //    docs/client-batch-import-design.md 第 8 节"枚举值不合法"）；
    // 2）同一个新客户内，代理国家不能重复（页面每个国家只能创建一条代理信息，导入按行分组理论上可能
    //    因用户填写疏漏出现重复国家，需拦截）。
    // 「每条代理信息下至少一条店铺」由 AgentInfoDto.shops 的 @ArrayMinSize(1) 统一校验，此处不重复判断。
    const seenCountries = new Set<string>();
    candidate.agentInfos.forEach((agent, index) => {
      const prefix = `agentInfos[${index}]`;
      if (agent.country && agent.agentCompany) {
        const expectedCountry = AGENT_COMPANY_COUNTRY[agent.agentCompany];
        if (expectedCountry !== agent.country) {
          issues.push({ field: `${prefix}.agentCompany`, message: '代理公司与代理国家不匹配' });
        }
      }
      if (agent.country) {
        if (seenCountries.has(agent.country)) {
          issues.push({ field: `${prefix}.country`, message: '同一客户下代理国家不能重复' });
        }
        seenCountries.add(agent.country);
      }
    });

    const dto = plainToInstance(ClientPayloadDto, candidate);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    for (const error of errors) {
      this.flattenConstraints(error, issues);
    }

    if (candidate.uniqueIdentifier) {
      const duplicate = await this.clientsService.findDuplicate(candidate.uniqueIdentifier);
      if (duplicate) {
        issues.push({ field: 'uniqueIdentifier', message: '该客户已存在，请勿重复创建' });
      }
    }

    return {
      payload: issues.length === 0 ? dto : undefined,
      reviewFields: candidate,
      issues,
      valid: issues.length === 0,
    };
  }

  private flattenConstraints(
    error: import('class-validator').ValidationError,
    issues: ReviewIssue[],
    prefix = '',
  ): void {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) {
      for (const message of Object.values(error.constraints)) {
        issues.push({ field, message });
      }
    }
    for (const child of error.children ?? []) {
      this.flattenConstraints(child, issues, field);
    }
  }
}
