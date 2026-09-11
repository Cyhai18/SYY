import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import * as path from 'path';

/**
 * 数据表 Sheet 名与表头行数，模板固定见 docs/授权客户导入模板（证件自动识别版）.xlsx。
 * 该版本模板不再要求手填公司/法人文字信息，改为营业执照/身份证图片走 OCR 自动识别，
 * 因此列结构与旧版"手填公司/法人信息"模板完全不同，见下方列号常量。
 */
const DATA_SHEET_NAME = '代理信息';
const FIRST_DATA_ROW = 4;

/** 模板列号（1-based，对应 exceljs row.getCell(c)），表头见模板第 1-3 行 */
const COL = {
  clientType: 1, // *注册类型
  businessLicenseImage: 2, // 营业执照图片
  idCardFrontImage: 3, // *身份证正面图片
  idCardBackImage: 4, // *身份证反面图片
  phone: 5, // *联系电话
  email: 6, // 联系邮箱
  remark: 7, // 备注
  agentCountry: 8, // *代理国家
  agentCompany: 9, // *代理公司
  expectedEffectiveDate: 10, // *期望生效日期
  agentYears: 11, // *代理年限
  shopPlatform: 12, // *平台
  shopId: 13, // 平台店铺ID
  shopName: 14, // *店铺名称
  shopUrl: 15, // *店铺链接
  brandNames: 16, // *品牌名称
  mainCategoryEn: 17, // *主营产品类目（英文）
  productPlatform: 18, // 销售平台
  productNameCn: 19, // 产品中文名称
  productNameEn: 20, // 产品英文名称
  category: 21, // 产品所属类目
  asinOrSku: 22, // ASIN码/商品ID
  productUrl: 23, // 产品链接
  hasBattery: 24, // 是否带电
} as const;

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
  /** 该版本模板不再提供手填公司文字字段，恒为 {}，公司信息完全由 RowValidatorService 合并营业执照 OCR 结果得出 */
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
  /** 该版本模板不再提供手填法人文字字段，恒为 {}，法人信息完全由 RowValidatorService 合并身份证 OCR 结果得出 */
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

/** 图片所在列（0-based col index，对应 exceljs `range.tl.col` 取整后的值），见模板第 2 行表头第 2/3/4 列 */
const IMAGE_COLS = {
  businessLicense: COL.businessLicenseImage - 1,
  idCardFront: COL.idCardFrontImage - 1,
  idCardBack: COL.idCardBackImage - 1,
};

/**
 * 解析单个批量导入 Excel（一个文件 = 一个客户）：读“代理信息”Sheet 的文字字段 + 用
 * `getImages()` 提取营业执照/身份证内嵌图片。只做“搬运”，不做字段校验/枚举翻译，
 * 该版本模板不含手填公司/法人文字字段，公司/法人信息完全交由 `RowValidatorService`
 * 合并 OCR 识别结果得出；枚举文字 -> 内部值的翻译、必填校验也统一交给它（见第 8 节）。
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
      // 一整行所有列都为空则视为数据结束，避免把表尾空行/说明行计入
      const hasAnyData = Object.values(COL).some((c) => cell(c));
      if (!hasAnyData) {
        continue;
      }
      result.dataRowCount += 1;

      if (!firstRowRead) {
        result.clientType = cell(COL.clientType) || undefined;
        result.phone = cell(COL.phone) || undefined;
        result.email = cell(COL.email) || undefined;
        result.remark = cell(COL.remark) || undefined;
        firstRowRead = true;
      }

      const country = cell(COL.agentCountry);
      const agentCompany = cell(COL.agentCompany);
      const expectedEffectiveDate = cell(COL.expectedEffectiveDate);
      const agentYears = cell(COL.agentYears);
      const agentKey = JSON.stringify([country, agentCompany, expectedEffectiveDate, agentYears]);
      let agentInfo = agentKeyToInfo.get(agentKey);
      if (!agentInfo) {
        agentInfo = {
          country: country || undefined,
          agentCompany: agentCompany || undefined,
          expectedEffectiveDate: expectedEffectiveDate || undefined,
          agentYears: agentYears ? Number(agentYears) : undefined,
          shops: [],
        };
        agentKeyToInfo.set(agentKey, agentInfo);
        result.agentInfos.push(agentInfo);
      }

      const shopName = cell(COL.shopName);
      const shopUrl = cell(COL.shopUrl);
      if (shopName || shopUrl) {
        const shopId = cell(COL.shopId);
        const shopPlatform = cell(COL.shopPlatform);
        const shopKey = JSON.stringify([shopPlatform, shopId, shopName, shopUrl]);
        let shop = agentInfo.shops.find(
          (s) => JSON.stringify([s.platform, s.shopId, s.shopName, s.shopUrl]) === shopKey,
        );
        if (!shop) {
          shop = {
            platform: shopPlatform || undefined,
            shopId: shopId || undefined,
            shopName: shopName || undefined,
            shopUrl: shopUrl || undefined,
            brandNames: cell(COL.brandNames) || undefined,
            mainCategoryEn: cell(COL.mainCategoryEn) || undefined,
            products: [],
          };
          agentInfo.shops.push(shop);
        }

        const productNameCn = cell(COL.productNameCn);
        const asinOrSku = cell(COL.asinOrSku);
        if (productNameCn || asinOrSku) {
          shop.products.push({
            platform: cell(COL.productPlatform) || undefined,
            productNameCn: productNameCn || undefined,
            productNameEn: cell(COL.productNameEn) || undefined,
            category: cell(COL.category) || undefined,
            asinOrSku: asinOrSku || undefined,
            productUrl: cell(COL.productUrl) || undefined,
            hasBattery: cell(COL.hasBattery) === '是',
          });
        }
      }
    }

    result.images = this.extractImages(workbook, ws);
    // exceljs 只识别图片存放于标准位置 `xl/media/*` 的内嵌图片；部分工具（如 WPS 导出）
    // 会把图片放在 `xl/drawings/media/*` 下，exceljs 无法解析，`getImages()` 恒为空，
    // 导致 OCR 完全拿不到图，误判为"用户没传图片"。这里兜底用 adm-zip 直接解析 drawing
    // XML 找回被漏掉的图片，仅在标准解析一张都没找到时触发，避免掩盖真正的空图片场景。
    if (!result.images.businessLicense && !result.images.idCardFront && !result.images.idCardBack) {
      try {
        const fallback = this.extractImagesFallback(filePath);
        if (fallback.businessLicense || fallback.idCardFront || fallback.idCardBack) {
          this.logger.warn(
            '标准方式未解析到内嵌图片，已通过兜底方案（xl/drawings/media）找回，建议确认 Excel 导出工具是否规范',
          );
        }
        result.images = fallback;
      } catch (err) {
        this.logger.debug(`图片兜底解析失败，忽略: ${String(err)}`);
      }
    }
    return result;
  }

  private extractImages(
    workbook: ExcelJS.Workbook,
    ws: ExcelJS.Worksheet,
  ): ParsedExcelResult['images'] {
    const candidates: Array<{ col: number; parsed: ParsedImage }> = [];
    for (const anchored of ws.getImages()) {
      const media = workbook.getImage(Number(anchored.imageId));
      if (!media?.buffer) {
        continue;
      }
      const mimetype = EXT_TO_MIME[media.extension] ?? 'image/png';
      candidates.push({
        col: anchored.range.tl.col,
        parsed: { buffer: Buffer.from(media.buffer as ArrayBuffer), mimetype },
      });
    }
    return this.assignImagesBySequentialOrder(candidates);
  }

  /**
   * 用户手动粘贴/拖拽图片到单元格时，图片锚点列未必精确等于目标列——常见现象是
   * 三张图片被"整体"同方向偏移（比如都往右偏了将近 1 列：实测出现过
   * col=1.999.../2.999.../3.999...，本应是 1/2/3）。
   *
   * 曾经按"每张图片就近匹配最近目标列"贪心分配，在整体偏移场景下会出错：
   * 本该属于营业执照（目标列 1）的图片实际锚点在 col≈2，距离身份证正面的目标列 2
   * 反而更近，于是被身份证正面槽位"抢走"，导致营业执照图片被错误地当身份证识别
   * （OCR 识别不出字段，字段全空），而真正靠右的身份证反面图片又因为槽位被占用/
   * 超出容差而被丢弃。
   *
   * 由于偏移通常是整体一致的，图片之间的左右相对顺序不会变——因此改为按“从左到右
   * 顺序”依次对应三个目标槽位（营业执照 < 身份证正面 < 身份证反面，模板列序固定），
   * 而不是按绝对列距离匹配。仅当候选图片列号与目标列区间相差过大时才过滤掉
   * （避免误把表格里其他位置的无关图片当成证件图片）。方法名按当前算法命名为
   * "按顺序分配"，不再是"就近匹配"。
   */
  private assignImagesBySequentialOrder(
    candidates: Array<{ col: number; parsed: ParsedImage }>,
  ): ParsedExcelResult['images'] {
    const BAND_MARGIN = 2.5;
    const slots: Array<{ key: keyof ParsedExcelResult['images']; col: number }> = [
      { key: 'businessLicense', col: IMAGE_COLS.businessLicense },
      { key: 'idCardFront', col: IMAGE_COLS.idCardFront },
      { key: 'idCardBack', col: IMAGE_COLS.idCardBack },
    ];
    slots.sort((a, b) => a.col - b.col);
    const minCol = slots[0].col - BAND_MARGIN;
    const maxCol = slots[slots.length - 1].col + BAND_MARGIN;

    const inBand: Array<{ col: number; parsed: ParsedImage }> = [];
    for (const candidate of candidates) {
      if (candidate.col >= minCol && candidate.col <= maxCol) {
        inBand.push(candidate);
      } else {
        this.logger.debug(`忽略未知列的内嵌图片，col=${candidate.col}`);
      }
    }
    inBand.sort((a, b) => a.col - b.col);

    const images: ParsedExcelResult['images'] = {};
    // 图片数量与槽位数量不一致时（比如用户漏传了某一张），无法可靠地判断到底缺的是
    // 哪一张，只能退化为"按顺序对齐前 N 个槽位"，尽量不丢已上传的图片。
    const count = Math.min(inBand.length, slots.length);
    for (let i = 0; i < count; i++) {
      images[slots[i].key] = inBand[i].parsed;
    }
    return images;
  }

  /**
   * 兜底图片解析：直接把 xlsx 当 zip 打开，解析 `xl/drawings/drawing*.xml` 里的
   * `<xdr:oneCellAnchor>`/`<xdr:twoCellAnchor>` 锚点（记录图片所在列 + 关系 ID），
   * 再通过对应 `xl/drawings/_rels/drawing*.xml.rels` 把关系 ID 换算成图片文件路径
   * （可能是 `xl/media/xxx.png` 也可能是非标准的 `xl/drawings/media/xxx.png`），
   * 最后从 zip 里读出图片二进制。仅用正则做轻量解析，不引入额外 XML 解析依赖。
   */
  private extractImagesFallback(filePath: string): ParsedExcelResult['images'] {
    const candidates: Array<{ col: number; parsed: ParsedImage }> = [];
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const drawingEntries = entries.filter((e) =>
      /^xl\/drawings\/drawing\d+\.xml$/.test(e.entryName),
    );

    for (const drawingEntry of drawingEntries) {
      const drawingXml = drawingEntry.getData().toString('utf-8');
      const relsEntry = entries.find(
        (e) => e.entryName === `xl/drawings/_rels/${path.basename(drawingEntry.entryName)}.rels`,
      );
      if (!relsEntry) continue;
      const relsXml = relsEntry.getData().toString('utf-8');

      const ridToTarget = new Map<string, string>();
      const relRegex =
        /<Relationship[^>]*Id="(rId\d+)"[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/g;
      let relMatch: RegExpExecArray | null;
      while ((relMatch = relRegex.exec(relsXml))) {
        ridToTarget.set(relMatch[1], relMatch[2]);
      }

      const anchorRegex = /<xdr:(?:one|two)CellAnchor>([\s\S]*?)<\/xdr:(?:one|two)CellAnchor>/g;
      let anchorMatch: RegExpExecArray | null;
      while ((anchorMatch = anchorRegex.exec(drawingXml))) {
        const block = anchorMatch[1];
        const colMatch = /<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>/.exec(block);
        const embedMatch = /r:embed="(rId\d+)"/.exec(block);
        if (!colMatch || !embedMatch) continue;
        const col = Number(colMatch[1]);
        const target = ridToTarget.get(embedMatch[1]);
        if (!target) continue;

        const resolvedPath = path.posix
          .normalize(path.posix.join('xl/drawings', target))
          .replace(/^\/+/, '');
        const mediaEntry = entries.find((e) => e.entryName === resolvedPath);
        if (!mediaEntry) continue;

        const ext = path.extname(resolvedPath).replace('.', '').toLowerCase();
        const mimetype = EXT_TO_MIME[ext] ?? 'image/png';
        const parsed: ParsedImage = { buffer: mediaEntry.getData(), mimetype };
        candidates.push({ col, parsed });
      }
    }
    const images = this.assignImagesBySequentialOrder(candidates);
    return images;
  }

  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object' && 'richText' in (value as unknown as Record<string, unknown>)) {
      return ((value as unknown as { richText: Array<{ text: string }> }).richText ?? [])
        .map((r) => r.text)
        .join('')
        .trim();
    }
    // 超链接单元格（如邮箱/网址加了 mailto:/http 链接）：value 形如 { text, hyperlink }，
    // 其中 text 既可能是纯字符串，也可能是带格式的 richText 对象（见上一分支），需递归解出纯文本，
    // 否则直接 String(value.text) 会拿到 "[object Object]"。
    if (typeof value === 'object' && 'text' in (value as unknown as Record<string, unknown>)) {
      return this.cellText((value as unknown as { text: ExcelJS.CellValue }).text);
    }
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return String(value).trim();
  }
}
