import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClientType } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLogService } from '../common/action-log/action-log.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

const PLATFORM_LABELS: Record<string, string> = {
  AMAZON: 'Amazon',
  TEMU: 'Temu',
  SHEIN: 'Shein',
  TIKTOK: 'TikTok',
  ALIEXPRESS: '速卖通',
  ALIBABA_ICBU: '阿里国际站',
  FRUUGO: 'Fruugo',
  OTHER: '其他',
};

/** 存放生成 PDF 的本地目录，过渡方案，后续接对象存储时替换 */
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'certificates');

/** `docs/certificate-generation-design.md` 第六节：编号生成、字段组装、调用 doc-service、落库。 */
@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);
  private readonly docServiceUrl = process.env.DOC_SERVICE_URL;

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionLogService: ActionLogService,
  ) {}

  async generate(agentInfoId: string, actor: AuthenticatedUser, meta: RequestMeta) {
    const agentInfo = await this.prisma.agentInfo.findUnique({
      where: { id: agentInfoId },
      include: {
        client: { include: { companyInfo: true, legalRepInfo: true } },
        shops: { include: { products: true } },
      },
    });
    if (!agentInfo) {
      throw new NotFoundException('代理信息不存在');
    }
    const { client } = agentInfo;

    const isCompany = client.clientType === ClientType.COMPANY;
    const nameCn = isCompany ? client.companyInfo?.nameCn : client.legalRepInfo?.nameCn;
    const nameEn = isCompany ? client.companyInfo?.nameEn : client.legalRepInfo?.namePinyin;
    const addressCn = isCompany ? client.companyInfo?.addressCn : client.legalRepInfo?.idAddressCn;
    const addressEn = isCompany ? client.companyInfo?.addressEn : client.legalRepInfo?.idAddressEn;
    const zip = isCompany ? client.companyInfo?.postalCode : client.legalRepInfo?.idPostalCode;

    const effectiveStart = agentInfo.expectedEffectiveDate;
    const effectiveEnd = agentInfo.expiresAt;

    const data = {
      agreement_number: '', // 生成后回填
      effective_range_en: `${formatDateEn(effectiveStart)} to ${formatDateEn(effectiveEnd)}`,
      effective_range_cn: `${formatDateCn(effectiveStart)}至${formatDateCn(effectiveEnd)}`,
      party_a_name_cn: nameCn ?? '',
      party_a_name_en: nameEn ?? '',
      party_a_address_cn: addressCn ?? '',
      party_a_address_en: addressEn ?? '',
      party_a_zip: zip ?? '',
      party_a_contact: client.legalRepInfo?.namePinyin ?? '',
      party_a_tel: client.phone,
      party_a_email: client.email ?? '',
      signing_date: formatDateEn(effectiveStart),
      shops: agentInfo.shops.map((s) => ({
        platform: PLATFORM_LABELS[s.platform] ?? s.platform,
        shop_url: s.shopUrl,
        shop_id: s.shopId ?? '',
        shop_name: s.shopName,
        brand_names: s.brandNames,
        product_names_cn: s.products.map((p) => p.productNameCn).join('、'),
        product_names_en: s.products.map((p) => p.productNameEn).join(', '),
      })),
    };

    const agreementNumber = await this.nextAgreementNumber();
    data.agreement_number = agreementNumber;

    const pdfBuffer = await this.callDocService(agentInfo.agentCompany, data);

    await mkdir(UPLOAD_DIR, { recursive: true });
    const fileName = `${agreementNumber}.pdf`;
    const filePath = join(UPLOAD_DIR, fileName);
    await writeFile(filePath, pdfBuffer);

    await this.prisma.certificate.create({
      data: {
        agentInfoId,
        agreementNumber,
        fileUrl: join('uploads', 'certificates', fileName),
        generatedById: actor.id,
      },
    });

    await this.actionLogService.record({
      userId: actor.id,
      action: 'GENERATE_CERTIFICATE',
      detail: JSON.stringify({ agentInfoId, agreementNumber }),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { fileName, buffer: pdfBuffer };
  }

  /** 按天原子自增计数器，避免并发下"先 COUNT 再 +1"的竞态 */
  private async nextAgreementNumber(): Promise<string> {
    const today = formatDay(new Date());
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO CertificateDailyCounter (day, seq) VALUES (?, 1)
       ON DUPLICATE KEY UPDATE seq = seq + 1`,
      today,
    );
    const row = await this.prisma.certificateDailyCounter.findUniqueOrThrow({
      where: { day: today },
    });
    return `${today.replace(/-/g, '')}${String(row.seq).padStart(4, '0')}`;
  }

  private async callDocService(
    templateKey: string,
    data: Record<string, unknown>,
  ): Promise<Buffer> {
    if (!this.docServiceUrl) {
      throw new BadGatewayException('证书生成服务未配置（DOC_SERVICE_URL）');
    }
    try {
      const response = await fetch(`${this.docServiceUrl}/certificate/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey, data }),
      });
      if (!response.ok) {
        this.logger.warn(`[Certificate] doc-service 返回 HTTP ${response.status}`);
        throw new BadGatewayException('证书生成服务调用失败');
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      this.logger.warn(`[Certificate] doc-service 调用异常：${String(err)}`);
      throw new BadGatewayException('证书生成服务调用失败');
    }
  }
}

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateEn(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateCn(d: Date): string {
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
}
