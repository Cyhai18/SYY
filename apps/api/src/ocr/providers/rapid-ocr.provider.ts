import { Injectable, Logger } from '@nestjs/common';
import type {
  BusinessLicenseFields,
  IdCardFields,
  OcrProvider,
  ProviderResult,
  UploadedFileLike,
} from '../ocr.service';

/** 微服务 doc_type 取值：business_license / id_card_front / id_card_back（见 services/ocr-service/app.py）。 */
type OcrDocType = 'business_license' | 'id_card_front' | 'id_card_back';

/**
 * RapidOCR 微服务（services/ocr-service/app.py + parsers.py）约定的 JSON 响应结构。
 * 结构化字段提取（标签定位、正则校验、校验位算法）由微服务侧 `parsers.py` 完成，
 * Nest 侧只做字段名从 snake_case 到 camelCase 的映射，不重复实现规则。
 */
interface RapidOcrServiceFields {
  name?: string;
  address?: string;
  legal_person?: string;
  credit_code?: string;
  id_number?: string;
  name_en?: string;
  address_en?: string;
  province_en?: string;
  city_en?: string;
  postal_code?: string;
  name_pinyin?: string;
}

interface RapidOcrServiceResponse {
  docType: OcrDocType;
  fields: RapidOcrServiceFields;
  rawText: string[];
}

/**
 * 调用本机/内网 RapidOCR 微服务（见 docs/client-profile-design.md 第 3.1/6 节）识别营业执照/身份证。
 * 微服务地址由 `OCR_SERVICE_URL` 配置；未配置或调用失败时优雅降级为“未识别”，
 * 前端按约定展示统一提示语，不阻断向导流程——这样接口在 Python 服务未部署的环境下也能正常跑通。
 * 微服务侧统一为单一 `/recognize` 入口，按 `doc_type` 区分证照类型并提取结构化字段。
 */
@Injectable()
export class RapidOcrProvider implements OcrProvider {
  private readonly logger = new Logger(RapidOcrProvider.name);
  private readonly serviceUrl = process.env.OCR_SERVICE_URL;

  async recognizeBusinessLicense(
    file: UploadedFileLike,
  ): Promise<ProviderResult<BusinessLicenseFields>> {
    const raw = await this.callService('business_license', file);
    if (!raw) return { fields: {}, rawText: [], recognized: false };
    const fields: BusinessLicenseFields = {
      creditCode: raw.fields.credit_code || undefined,
      nameCn: raw.fields.name || undefined,
      addressCn: raw.fields.address || undefined,
      nameEn: raw.fields.name_en || undefined,
      addressEn: raw.fields.address_en || undefined,
      provinceEn: raw.fields.province_en || undefined,
      cityEn: raw.fields.city_en || undefined,
      postalCode: raw.fields.postal_code || undefined,
    };
    return { fields, rawText: raw.rawText, recognized: true };
  }

  async recognizeIdCard(
    file: UploadedFileLike,
    side: 'front' | 'back',
  ): Promise<ProviderResult<IdCardFields>> {
    const raw = await this.callService(side === 'front' ? 'id_card_front' : 'id_card_back', file);
    if (!raw) return { fields: {}, rawText: [], recognized: false };
    const fields: IdCardFields = {
      nameCn: raw.fields.name || undefined,
      idNumber: raw.fields.id_number || undefined,
      namePinyin: raw.fields.name_pinyin || undefined,
      idAddressCn: raw.fields.address || undefined,
      idAddressEn: raw.fields.address_en || undefined,
      idPostalCode: raw.fields.postal_code || undefined,
    };
    return { fields, rawText: raw.rawText, recognized: true };
  }

  private async callService(
    docType: OcrDocType,
    file: UploadedFileLike,
  ): Promise<RapidOcrServiceResponse | null> {
    if (!this.serviceUrl) {
      this.logger.warn(
        `[OCR] RapidOCR 微服务未配置 OCR_SERVICE_URL，跳过识别：${file.originalname}`,
      );
      return null;
    }
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
        file.originalname,
      );
      form.append('doc_type', docType);
      const response = await fetch(`${this.serviceUrl}/recognize`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        this.logger.warn(`[OCR] RapidOCR 微服务返回 HTTP ${response.status}：${file.originalname}`);
        return null;
      }
      return (await response.json()) as RapidOcrServiceResponse;
    } catch (err) {
      this.logger.warn(`[OCR] RapidOCR 微服务调用失败：${String(err)}`);
      return null;
    }
  }
}
