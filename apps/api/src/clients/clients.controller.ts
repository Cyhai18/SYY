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
import { AttachmentType, ClientStatus } from '@prisma/client';
import { ClientsService, type ClientAttachmentInput } from './clients.service';
import { AppendAgentInfoDto, ClientPayloadDto } from './dto/client-payload.dto';
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
    this.assertRequiredAttachments(dto.clientType, attachments);
    // /clients/new 向导录入的客户统一置为"正常"，与批量导入（默认待审核）区分开。
    return this.clientsService.createClient(
      dto,
      user,
      meta,
      undefined,
      attachments,
      ClientStatus.NORMAL,
    );
  }

  /**
   * 单条录入向导要求营业执照/身份证图片必填（批量导入走 Excel 内嵌图片，识别失败会转人工核对，
   * 不在此处强制，避免误伤既有导入流程）。
   */
  private assertRequiredAttachments(
    clientType: ClientPayloadDto['clientType'],
    attachments: ClientAttachmentInput[],
  ) {
    const types = new Set(attachments.map((a) => a.type));
    if (clientType === 'COMPANY' && !types.has(AttachmentType.BUSINESS_LICENSE)) {
      throw new BadRequestException('请上传营业执照');
    }
    if (clientType === 'INDIVIDUAL') {
      if (!types.has(AttachmentType.ID_CARD_FRONT) || !types.has(AttachmentType.ID_CARD_BACK)) {
        throw new BadRequestException('请上传身份证人像面和国徽面');
      }
    }
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

  /**
   * 供证件 OCR 识别成功后触发的查重：统一信用代码/身份证号禁止手动编辑，只能由 OCR 识别得出，
   * 命中已存在客户时返回其 companyInfo/legalRepInfo 供前端回填表单，并切换到"追加代理信息"模式。
   * 必须声明在 `:id` 路由之前，否则会被 `:id` 吞掉。
   */
  @Get('duplicate-check')
  async duplicateCheck(@Query('creditCode') creditCode?: string) {
    if (!creditCode?.trim()) {
      throw new BadRequestException('creditCode 不能为空');
    }
    const client = await this.clientsService.checkDuplicate(creditCode.trim());
    return { exists: !!client, client };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.findOne(id, user);
  }

  /**
   * 老客户追加代理信息：与 `create()` 一样走 multipart（新上传的证件图片按最新覆盖），
   * 但目标是已存在客户，统一信用代码/身份证号锁定不可变更，见 ClientsService.appendAgentInfo。
   */
  @Post(':id/agent-infos')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'businessLicenseFile', maxCount: 1 },
      { name: 'idCardFrontFile', maxCount: 1 },
      { name: 'idCardBackFile', maxCount: 1 },
    ]),
  )
  async appendAgentInfo(
    @Param('id') id: string,
    @Body('payload') payloadJson: string,
    @UploadedFiles() files: ClientAttachmentFiles,
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const dto = await this.parseAppendPayload(payloadJson);
    const attachments = this.collectAttachments(files);
    return this.clientsService.appendAgentInfo(id, dto, user, meta, attachments);
  }

  private async parseAppendPayload(payloadJson: string): Promise<AppendAgentInfoDto> {
    let raw: unknown;
    try {
      raw = JSON.parse(payloadJson);
    } catch {
      throw new BadRequestException('payload 不是合法的 JSON');
    }
    const dto = plainToInstance(AppendAgentInfoDto, raw);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const message = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
      throw new BadRequestException(message || '参数校验失败');
    }
    return dto;
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
