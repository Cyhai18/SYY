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
};

/** 反查 label -> enum value，找不到时返回 undefined（交由后续 class-validator 判定为必填缺失/不合法） */
function reverseLabel<T extends string>(labels: Record<T, string>, value?: string): T | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const entry = (Object.entries(labels) as Array<[T, string]>).find(
    ([, label]) => label === trimmed,
  );
  return entry?.[0];
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
    };

    const legalRepInfo = {
      nameCn: parsed.legalRepInfo.nameCn || idCardFrontOcr?.fields.nameCn,
      namePinyin: parsed.legalRepInfo.namePinyin || idCardFrontOcr?.fields.namePinyin,
      idNumber: parsed.legalRepInfo.idNumber || idCardFrontOcr?.fields.idNumber,
      idAddressCn: parsed.legalRepInfo.idAddressCn || idCardFrontOcr?.fields.idAddressCn,
      idAddressEn: parsed.legalRepInfo.idAddressEn || idCardFrontOcr?.fields.idAddressEn,
      idPostalCode: parsed.legalRepInfo.idPostalCode || idCardFrontOcr?.fields.idPostalCode,
    };

    const candidate = {
      clientType: reverseLabel(CLIENT_TYPE_LABELS, parsed.clientType),
      phone: parsed.phone,
      email: parsed.email,
      remark: parsed.remark,
      companyInfo,
      legalRepInfo,
      agentInfos: parsed.agentInfos.map((agent) => ({
        country: reverseLabel(AGENT_COUNTRY_LABELS, agent.country),
        agentCompany: reverseLabel(AGENT_COMPANY_LABELS, agent.agentCompany),
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

    const dto = plainToInstance(ClientPayloadDto, candidate);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    for (const error of errors) {
      this.flattenConstraints(error, issues);
    }

    if (candidate.companyInfo.creditCode) {
      const duplicate = await this.clientsService.findDuplicate(candidate.companyInfo.creditCode);
      if (duplicate) {
        issues.push({ field: 'companyInfo.creditCode', message: '该客户已存在，请勿重复创建' });
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
