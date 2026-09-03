import { Inject, Injectable } from '@nestjs/common';

/** 最小化的上传文件描述，避免引入 multer 类型依赖；接入真实上传时可替换为 Express.Multer.File。 */
export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
}

export interface BusinessLicenseFields {
  creditCode?: string;
  nameCn?: string;
  nameEn?: string;
  addressCn?: string;
  addressEn?: string;
  provinceEn?: string;
  cityEn?: string;
  postalCode?: string;
}

export interface IdCardFields {
  nameCn?: string;
  idNumber?: string;
  namePinyin?: string;
  idAddressCn?: string;
  idAddressEn?: string;
  idPostalCode?: string;
}

/** Provider 只负责“认图”，图片不落盘，识别完即由调用方丢弃。 */
export interface ProviderResult<T> {
  fields: T;
  /** 引擎输出的原始文本行，供排查识别问题时参考（结构化字段已在微服务侧提取完成）。 */
  rawText: string[];
  recognized: boolean;
}

export interface OcrResult<T> {
  fields: T;
  recognized: boolean;
}

/** 引擎无关的 OCR Provider 接口，当前实现见 providers/rapid-ocr.provider.ts，后续可加云厂商 Provider 兜底。 */
export interface OcrProvider {
  recognizeBusinessLicense(file: UploadedFileLike): Promise<ProviderResult<BusinessLicenseFields>>;
  recognizeIdCard(
    file: UploadedFileLike,
    side: 'front' | 'back',
  ): Promise<ProviderResult<IdCardFields>>;
}

export const OCR_PROVIDER = Symbol('OCR_PROVIDER');

/**
 * OCR 编排层：调用底层 Provider 拿到结构化字段（结构化提取由微服务侧
 * `services/ocr-service/parsers.py` 完成，Nest 侧不重复实现规则）。
 * 营业执照/身份证图片仅用于识别，图片 buffer 全程不落盘、识别完成即丢弃，不产生 Attachment 记录
 * （见 docs/client-profile-design.md 决策记录）。
 * 单条录入向导与批量导入（若需要）共用本服务，见第 3.4 节。
 */
@Injectable()
export class OcrService {
  constructor(@Inject(OCR_PROVIDER) private readonly provider: OcrProvider) {}

  async recognizeBusinessLicense(
    file: UploadedFileLike,
  ): Promise<OcrResult<BusinessLicenseFields>> {
    const result = await this.provider.recognizeBusinessLicense(file);
    const recognized = result.recognized || Boolean(result.fields.creditCode);
    return { fields: result.fields, recognized };
  }

  async recognizeIdCard(
    file: UploadedFileLike,
    side: 'front' | 'back',
  ): Promise<OcrResult<IdCardFields>> {
    const result = await this.provider.recognizeIdCard(file, side);
    const recognized = result.recognized || Boolean(result.fields.idNumber);
    return { fields: result.fields, recognized };
  }
}
