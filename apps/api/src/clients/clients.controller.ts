import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AttachmentType } from '@prisma/client';
import { ClientsService, type ClientAttachmentInput } from './clients.service';
import { ClientPayloadDto } from './dto/client-payload.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReqMeta } from '../common/decorators/request-meta.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import type { RequestMeta } from '../auth/auth.service';
import type { UploadedFileLike } from '../ocr/ocr.service';

interface ClientAttachmentFiles {
  businessLicenseFile?: UploadedFileLike[];
  idCardFrontFile?: UploadedFileLike[];
  idCardBackFile?: UploadedFileLike[];
}

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  /**
   * 提交改为 multipart/form-data：文字字段以 JSON 字符串放在 `payload` 字段，
   * 营业执照/身份证正反面三个可选文件字段与向导内 OCR 识别用的图片是同一份，
   * 见 docs/client-batch-import-design.md 第 5.2 节。
   */
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'businessLicenseFile', maxCount: 1 },
      { name: 'idCardFrontFile', maxCount: 1 },
      { name: 'idCardBackFile', maxCount: 1 },
    ]),
  )
  async create(
    @Body('payload') payloadJson: string,
    @UploadedFiles() files: ClientAttachmentFiles,
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const dto = await this.parsePayload(payloadJson);
    const attachments = this.collectAttachments(files);
    return this.clientsService.createClient(dto, user, meta, undefined, attachments);
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

  private collectAttachments(files: ClientAttachmentFiles): ClientAttachmentInput[] {
    const mapping: Array<[keyof ClientAttachmentFiles, AttachmentType]> = [
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

  @Get()
  async findAll(@Query() query: ListClientsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.findAll(query, user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.findOne(id, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clientsService.update(id, dto, user, meta);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clientsService.softDelete(id, user, meta);
  }
}
