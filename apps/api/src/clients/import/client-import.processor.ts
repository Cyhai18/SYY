import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AttachmentType, ClientStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientsService, type ClientAttachmentInput } from '../clients.service';
import {
  CLIENT_IMPORT_QUEUE_NAME,
  REDIS_CONNECTION,
  type ClientImportJobData,
} from '../../queue/queue.constants';
import { ZipExtractorService, type ExtractedXlsxFile } from './zip-extractor.service';
import { ExcelParserService } from './excel-parser.service';
import { RowValidatorService } from './row-validator.service';

/** 单批次内子文件的处理并发数，见 docs/client-batch-import-design.md 第 6.2/11 节 */
const ITEM_CONCURRENCY = 3;

/**
 * 批量导入 BullMQ Worker：解压 ZIP → 逐文件解析 Excel + OCR + 校验 → 落库，
 * 维护 `ClientImportJob`/`ClientImportItem` 状态机（第 6.3 节）。
 */
@Injectable()
export class ClientImportProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClientImportProcessor.name);
  private worker?: Worker<ClientImportJobData>;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    private readonly prisma: PrismaService,
    private readonly zipExtractor: ZipExtractorService,
    private readonly excelParser: ExcelParserService,
    private readonly rowValidator: RowValidatorService,
    private readonly clientsService: ClientsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ClientImportJobData>(
      CLIENT_IMPORT_QUEUE_NAME,
      (job) => this.handle(job),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`导入批次处理失败 jobId=${job?.data.jobId} err=${String(err)}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async handle(job: Job<ClientImportJobData>): Promise<void> {
    const { jobId, zipFilePath } = job.data;
    const importJob = await this.prisma.clientImportJob.findUnique({
      where: { id: jobId },
      include: { createdBy: true },
    });
    if (!importJob) {
      this.logger.warn(`ClientImportJob 不存在，跳过: jobId=${jobId}`);
      return;
    }

    await this.prisma.clientImportJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING' },
    });

    const actor = {
      id: importJob.createdBy.id,
      phone: importJob.createdBy.phone,
      role: importJob.createdBy.role,
    };
    const meta = {};

    const { extractDir, files } = this.zipExtractor.extract(zipFilePath, jobId);
    await this.prisma.clientImportJob.update({
      where: { id: jobId },
      data: { totalCount: files.length },
    });
    const items = await Promise.all(
      files.map((file) =>
        this.prisma.clientImportItem.create({ data: { jobId, fileName: file.fileName } }),
      ),
    );

    let successCount = 0;
    let reviewCount = 0;
    let failedCount = 0;

    for (let i = 0; i < files.length; i += ITEM_CONCURRENCY) {
      const batch = files.slice(i, i + ITEM_CONCURRENCY).map((file, offset) => ({
        file,
        item: items[i + offset],
      }));
      const results = await Promise.all(
        batch.map(({ file, item }) =>
          this.processFile(file, item.id, actor, meta).catch((err) => {
            this.logger.error(`处理文件异常 fileName=${file.fileName} err=${String(err)}`);
            return 'FAILED' as const;
          }),
        ),
      );
      for (const status of results) {
        if (status === 'SUCCESS') successCount += 1;
        else if (status === 'NEEDS_REVIEW') reviewCount += 1;
        else failedCount += 1;
      }
    }

    this.zipExtractor.cleanup(extractDir);
    await unlink(zipFilePath).catch(() => undefined);

    await this.prisma.clientImportJob.update({
      where: { id: jobId },
      data: { status: 'DONE', successCount, reviewCount, failedCount, finishedAt: new Date() },
    });
  }

  private async processFile(
    file: ExtractedXlsxFile,
    itemId: string,
    actor: { id: string; phone: string; role: import('@prisma/client').Role },
    meta: { ip?: string; userAgent?: string },
  ): Promise<'SUCCESS' | 'NEEDS_REVIEW' | 'FAILED'> {
    await this.prisma.clientImportItem.update({
      where: { id: itemId },
      data: { status: 'OCR_PROCESSING' },
    });

    let parsed;
    try {
      parsed = await this.excelParser.parse(file.filePath);
    } catch (err) {
      await this.prisma.clientImportItem.update({
        where: { id: itemId },
        data: { status: 'FAILED', errorReason: `Excel 解析失败: ${String(err)}` },
      });
      return 'FAILED';
    }

    const result = await this.rowValidator.validate(parsed);
    if (!result.valid || !result.payload) {
      await this.prisma.clientImportItem.update({
        where: { id: itemId },
        data: {
          status: 'NEEDS_REVIEW',
          reviewFields: result.reviewFields as unknown as object,
          reviewIssues: result.issues as unknown as object,
        },
      });
      return 'NEEDS_REVIEW';
    }

    const attachments: ClientAttachmentInput[] = [];
    if (parsed.images.businessLicense) {
      attachments.push({
        type: AttachmentType.BUSINESS_LICENSE,
        buffer: parsed.images.businessLicense.buffer,
        mimetype: parsed.images.businessLicense.mimetype,
        originalName: `${file.fileName}-business-license`,
      });
    }
    if (parsed.images.idCardFront) {
      attachments.push({
        type: AttachmentType.ID_CARD_FRONT,
        buffer: parsed.images.idCardFront.buffer,
        mimetype: parsed.images.idCardFront.mimetype,
        originalName: `${file.fileName}-id-front`,
      });
    }
    if (parsed.images.idCardBack) {
      attachments.push({
        type: AttachmentType.ID_CARD_BACK,
        buffer: parsed.images.idCardBack.buffer,
        mimetype: parsed.images.idCardBack.mimetype,
        originalName: `${file.fileName}-id-back`,
      });
    }

    try {
      // 批量导入自动校验通过（无需人工核对）的客户，与单条录入向导一致直接置为"正常"，
      // 不再落在默认的 PENDING_REVIEW，避免导入成功后客户列表里还显示"待审核"。
      const client = await this.clientsService.createClient(
        result.payload,
        actor,
        meta,
        undefined,
        attachments,
        ClientStatus.NORMAL,
      );
      await this.prisma.clientImportItem.update({
        where: { id: itemId },
        data: { status: 'SUCCESS', clientId: client.id },
      });
      return 'SUCCESS';
    } catch (err) {
      await this.prisma.clientImportItem.update({
        where: { id: itemId },
        data: { status: 'FAILED', errorReason: `创建客户失败: ${String(err)}` },
      });
      return 'FAILED';
    }
  }
}
