import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';

/** 数据表 Sheet 名与表头行数，模板固定见 docs/授权客户批量导入模板.xlsx */
const DATA_SHEET_NAME = '授权客户信息';
const FIRST_DATA_ROW = 4;

/** 解析出的“文字字段”候选值，字段是否齐全交由 RowValidatorService 判定，这里只做搬运不做校验 */
export interface ParsedProduct {
  platform?: string;
  productNameCn?: string;
  productNameEn?: string;
  category?: string;
  asinOrSku?: string;
  productUrl?: string;
  hasBattery?: boolean;
}

export interface ParsedShop {
  platform?: string;
  shopId?: string;
  shopName?: string;
  shopUrl?: string;
  brandNames?: string;
  mainCategoryEn?: string;
  products: ParsedProduct[];
}

export interface ParsedAgentInfo {
  country?: string;
  agentCompany?: string;
  expectedEffectiveDate?: string;
  agentYears?: number;
  shops: ParsedShop[];
}

export interface ParsedImage {
  buffer: Buffer;
  mimetype: string;
}

export interface ParsedExcelResult {
  clientType?: string;
  phone?: string;
  email?: string;
  remark?: string;
  companyInfo: {
    creditCode?: string;
    nameCn?: string;
    nameEn?: string;
    addressCn?: string;
    addressEn?: string;
    provinceEn?: string;
    cityEn?: string;
    postalCode?: string;
  };
  legalRepInfo: {
    nameCn?: string;
    namePinyin?: string;
    idNumber?: string;
    idAddressCn?: string;
    idAddressEn?: string;
    idPostalCode?: string;
  };
  agentInfos: ParsedAgentInfo[];
  images: {
    businessLicense?: ParsedImage;
    idCardFront?: ParsedImage;
    idCardBack?: ParsedImage;
  };
  /** 有数据的行数（用于“空文件”兜底判断） */
  dataRowCount: number;
}

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** 图片所在列（0-based col index，对应 exceljs `range.tl.col` 取整后的值），见模板第 2 行表头第 13/20/21 列 */
const IMAGE_COLS = {
  businessLicense: 12,
  idCardFront: 19,
  idCardBack: 20,
};

/**
 * 解析单个批量导入 Excel（一个文件 = 一个客户）：读“授权客户信息”Sheet 的文字字段 + 用
 * `getImages()` 提取营业执照/身份证内嵌图片。只做“搬运”，不做字段校验/枚举翻译，
 * 枚举文字 -> 内部值的翻译、必填校验统一交给 `RowValidatorService`（见第 8 节）。
 */
@Injectable()
export class ExcelParserService {
  private readonly logger = new Logger(ExcelParserService.name);

  async parse(filePath: string): Promise<ParsedExcelResult> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const ws = workbook.getWorksheet(DATA_SHEET_NAME);
    if (!ws) {
      throw new Error(`未找到「${DATA_SHEET_NAME}」Sheet，请使用官方模板`);
    }

    const result: ParsedExcelResult = {
      companyInfo: {},
      legalRepInfo: {},
      agentInfos: [],
      images: {},
      dataRowCount: 0,
    };

    const agentKeyToInfo = new Map<string, ParsedAgentInfo>();
    let firstRowRead = false;

    for (let r = FIRST_DATA_ROW; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cell = (c: number) => this.cellText(row.getCell(c).value);
      const creditCode = cell(5);
      // 一整行全部为空则视为数据结束，避免把表尾空行/说明行计入
      if (!creditCode && !cell(2) && !cell(6)) {
        continue;
      }
      result.dataRowCount += 1;

      if (!firstRowRead) {
        result.clientType = cell(1);
        result.phone = cell(2);
        result.email = cell(3) || undefined;
        result.remark = cell(4) || undefined;
        result.companyInfo = {
          creditCode: creditCode || undefined,
          nameCn: cell(6) || undefined,
          nameEn: cell(7) || undefined,
          addressCn: cell(8) || undefined,
          addressEn: cell(9) || undefined,
          provinceEn: cell(10) || undefined,
          cityEn: cell(11) || undefined,
          postalCode: cell(12) || undefined,
        };
        result.legalRepInfo = {
          nameCn: cell(14) || undefined,
          namePinyin: cell(15) || undefined,
          idNumber: cell(16) || undefined,
          idAddressCn: cell(17) || undefined,
          idAddressEn: cell(18) || undefined,
          idPostalCode: cell(19) || undefined,
        };
        firstRowRead = true;
      }

      const agentKey = JSON.stringify([cell(22), cell(23), cell(24), cell(25)]);
      let agentInfo = agentKeyToInfo.get(agentKey);
      if (!agentInfo) {
        agentInfo = {
          country: cell(22) || undefined,
          agentCompany: cell(23) || undefined,
          expectedEffectiveDate: cell(24) || undefined,
          agentYears: cell(25) ? Number(cell(25)) : undefined,
          shops: [],
        };
        agentKeyToInfo.set(agentKey, agentInfo);
        result.agentInfos.push(agentInfo);
      }

      const shopName = cell(28);
      const shopUrl = cell(29);
      if (shopName || shopUrl) {
        const shopKey = JSON.stringify([cell(26), cell(27), shopName, shopUrl]);
        let shop = agentInfo.shops.find(
          (s) => JSON.stringify([s.platform, s.shopId, s.shopName, s.shopUrl]) === shopKey,
        );
        if (!shop) {
          shop = {
            platform: cell(26) || undefined,
            shopId: cell(27) || undefined,
            shopName: shopName || undefined,
            shopUrl: shopUrl || undefined,
            brandNames: cell(30) || undefined,
            mainCategoryEn: cell(31) || undefined,
            products: [],
          };
          agentInfo.shops.push(shop);
        }

        const productNameCn = cell(33);
        const asinOrSku = cell(36);
        if (productNameCn || asinOrSku) {
          shop.products.push({
            platform: cell(32) || undefined,
            productNameCn: productNameCn || undefined,
            productNameEn: cell(34) || undefined,
            category: cell(35) || undefined,
            asinOrSku: asinOrSku || undefined,
            productUrl: cell(37) || undefined,
            hasBattery: cell(38) === '是',
          });
        }
      }
    }

    result.images = this.extractImages(workbook, ws);
    return result;
  }

  private extractImages(
    workbook: ExcelJS.Workbook,
    ws: ExcelJS.Worksheet,
  ): ParsedExcelResult['images'] {
    const images: ParsedExcelResult['images'] = {};
    for (const anchored of ws.getImages()) {
      const col = Math.round(anchored.range.tl.col);
      const media = workbook.getImage(Number(anchored.imageId));
      if (!media?.buffer) {
        continue;
      }
      const mimetype = EXT_TO_MIME[media.extension] ?? 'image/png';
      const parsed: ParsedImage = { buffer: Buffer.from(media.buffer as ArrayBuffer), mimetype };
      if (col === IMAGE_COLS.businessLicense) {
        images.businessLicense = parsed;
      } else if (col === IMAGE_COLS.idCardFront) {
        images.idCardFront = parsed;
      } else if (col === IMAGE_COLS.idCardBack) {
        images.idCardBack = parsed;
      } else {
        this.logger.debug(`忽略未知列的内嵌图片，col=${col}`);
      }
    }
    return images;
  }

  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object' && 'text' in (value as unknown as Record<string, unknown>)) {
      return String((value as unknown as { text: unknown }).text ?? '').trim();
    }
    if (typeof value === 'object' && 'richText' in (value as unknown as Record<string, unknown>)) {
      return ((value as unknown as { richText: Array<{ text: string }> }).richText ?? [])
        .map((r) => r.text)
        .join('')
        .trim();
    }
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return String(value).trim();
  }
}
