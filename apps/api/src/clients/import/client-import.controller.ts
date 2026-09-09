import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AttachmentType, Prisma, Role } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientsService, type ClientAttachmentInput } from '../clients.service';
import { ClientPayloadDto } from '../dto/client-payload.dto';
import { ListImportJobsDto } from './dto/list-import-jobs.dto';
import { ListImportItemsDto } from './dto/list-import-items.dto';
import { CLIENT_IMPORT_QUEUE, type ClientImportJobData } from '../../queue/queue.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta } from '../../common/decorators/request-meta.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import type { RequestMeta } from '../../auth/auth.service';
import type { UploadedFileLike } from '../../ocr/ocr.service';

interface ReviewAttachmentFiles {
  businessLicenseFile?: UploadedFileLike[];
  idCardFrontFile?: UploadedFileLike[];
  idCardBackFile?: UploadedFileLike[];
}

/**
 * 批量导入接口：上传 ZIP 入队、状态/明细查询、NEEDS_REVIEW 项人工核对提交。
 * 见 docs/client-batch-import-design.md 第 7 节。
 */
@Controller('clients/import')
export class ClientImportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientsService: ClientsService,
    @Inject(CLIENT_IMPORT_QUEUE) private readonly queue: Queue<ClientImportJobData>,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('请上传 ZIP 文件');
    }
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('仅支持 .zip 文件');
    }

    const job = await this.prisma.clientImportJob.create({
      data: { fileName: file.originalname, createdById: user.id },
    });

    const tmpDir = join(tmpdir(), 'client-import-uploads');
    await mkdir(tmpDir, { recursive: true });
    const zipFilePath = join(tmpDir, `${job.id}-${randomUUID()}.zip`);
    await writeFile(zipFilePath, file.buffer);

    await this.queue.add('process', { jobId: job.id, zipFilePath });
    return job;
  }

  @Get()
  async list(@Query() query: ListImportJobsDto, @CurrentUser() user: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ClientImportJobWhereInput = {
      ...(user.role === Role.USER ? { createdById: user.id } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.clientImportJob.count({ where }),
      this.prisma.clientImportJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  @Get(':jobId')
  async findOne(@Param('jobId') jobId: string, @CurrentUser() user: AuthenticatedUser) {
    const job = await this.assertJobAccess(jobId, user);
    return job;
  }

  @Get(':jobId/items')
  async listItems(
    @Param('jobId') jobId: string,
    @Query() query: ListImportItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertJobAccess(jobId, user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const where: Prisma.ClientImportItemWhereInput = {
      jobId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.clientImportItem.count({ where }),
      this.prisma.clientImportItem.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  /**
   * NEEDS_REVIEW 项人工核对提交：前端拿 `reviewFields` 回填表单修正后，
   * 以与单条录入向导相同的 multipart 结构重新提交（`payload` JSON + 可选证件图片）。
   * 通过后复用 `ClientsService.createClient` 落库，成功后把该 item 置为 SUCCESS。
   */
  @Patch('items/:itemId')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'businessLicenseFile', maxCount: 1 },
      { name: 'idCardFrontFile', maxCount: 1 },
      { name: 'idCardBackFile', maxCount: 1 },
    ]),
  )
  async reviewItem(
    @Param('itemId') itemId: string,
    @Body('payload') payloadJson: string,
    @UploadedFiles() files: ReviewAttachmentFiles,
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const item = await this.prisma.clientImportItem.findUnique({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundException('导入明细不存在');
    }
    await this.assertJobAccess(item.jobId, user);
    if (item.status !== 'NEEDS_REVIEW' && item.status !== 'FAILED') {
      throw new BadRequestException('该明细无需核对');
    }

    const dto = await this.parsePayload(payloadJson);
    const attachments = this.collectAttachments(files);

    try {
      const client = await this.clientsService.createClient(
        dto,
        user,
        meta,
        undefined,
        attachments,
      );
      const previousStatus = item.status;
      const [, updatedItem] = await this.prisma.$transaction([
        this.prisma.clientImportJob.update({
          where: { id: item.jobId },
          data: {
            successCount: { increment: 1 },
            ...(previousStatus === 'NEEDS_REVIEW' ? { reviewCount: { decrement: 1 } } : {}),
            ...(previousStatus === 'FAILED' ? { failedCount: { decrement: 1 } } : {}),
          },
        }),
        this.prisma.clientImportItem.update({
          where: { id: itemId },
          data: { status: 'SUCCESS', clientId: client.id, errorReason: null },
        }),
      ]);
      return updatedItem;
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : '提交失败');
    }
  }

  private async assertJobAccess(jobId: string, user: AuthenticatedUser) {
    const job = await this.prisma.clientImportJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('导入批次不存在');
    }
    if (user.role === Role.USER && job.createdById !== user.id) {
      throw new ForbiddenException('无权访问该导入批次');
    }
    return job;
  }

  private async parsePayload(payloadJson: string): Promise<ClientPayloadDto> {
    let raw: unknown;
    try {
      raw = JSON.parse(payloadJson);
    } catch {
      throw new BadRequestException('payload 不是合法的 JSON');
    }
    const dto = plainToInstance(ClientPayloadDto, raw);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const message = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
      throw new BadRequestException(message || '参数校验失败');
    }
    return dto;
  }

  private collectAttachments(files: ReviewAttachmentFiles): ClientAttachmentInput[] {
    const mapping: Array<[keyof ReviewAttachmentFiles, AttachmentType]> = [
      ['businessLicenseFile', AttachmentType.BUSINESS_LICENSE],
      ['idCardFrontFile', AttachmentType.ID_CARD_FRONT],
      ['idCardBackFile', AttachmentType.ID_CARD_BACK],
    ];
    const attachments: ClientAttachmentInput[] = [];
    for (const [field, type] of mapping) {
      const file = files?.[field]?.[0];
      if (file) {
        attachments.push({
          type,
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalName: file.originalname,
        });
      }
    }
    return attachments;
  }
}
