import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AttachmentType, ClientStatus } from '@prisma/client';
import type { Response } from 'express';
import { ClientsService, type ClientAttachmentInput } from './clients.service';
import { WizardDraftService } from './wizard-draft.service';
import { AppendAgentInfoDto, ClientPayloadDto } from './dto/client-payload.dto';
import { UpdateAgentInfoDto, UpdateClientDto } from './dto/update-client.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { SaveWizardDraftDto } from './dto/wizard-draft.dto';
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
  constructor(
    private readonly clientsService: ClientsService,
    private readonly wizardDraftService: WizardDraftService,
  ) {}

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
    // 证件图片选填：唯一标识与主体/法人字段已支持手填，附件仅作可选留档/OCR 来源。
    // 批量导入仍在 RowValidatorService 按类型要求图片（模板无手填公司/法人列），不走此处。
    const attachments = this.collectAttachments(files);
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
   * 导出客户列表为 Excel，筛选口径与 `findAll` 一致（含权限隔离）。必须声明在 `:id` 路由之前，
   * 否则 "export" 会被当成 :id 参数匹配掉。
   */
  @Get('export')
  async export(
    @Query() query: ListClientsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const buffer = await this.clientsService.exportClients(query, user);
    const fileName = `客户列表_${this.formatExportTimestamp()}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    res.send(buffer);
  }

  private formatExportTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  /**
   * 按当前筛选范围把代理证书打包成 ZIP 下载，筛选口径与 `export`/`findAll` 一致。
   * 超过 500 份时不报错，取前 500 份打包，并通过 `X-Export-Truncated` 响应头告知前端弹提示。
   * 必须声明在 `:id` 路由之前，否则 "export-certificates" 会被当成 :id 参数匹配掉。
   */
  @Get('export-certificates')
  async exportCertificates(
    @Query() query: ListClientsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { buffer, truncated } = await this.clientsService.exportCertificatesZip(query, user);
    const fileName = `证书_${this.formatExportTimestamp()}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Access-Control-Expose-Headers': 'X-Export-Truncated',
      'X-Export-Truncated': String(truncated),
    });
    res.send(buffer);
  }

  /**
   * 向导 / 导入 Review 查重：参数名为历史兼容的 `creditCode`，实际传唯一标识
   * （企业=统一社会信用代码，个人=身份证号）。CREATE 下手填或 OCR 后均可调用。
   * 必须声明在 `:id` 路由之前，否则会被 `:id` 吞掉。
   */
  @Get('duplicate-check')
  async duplicateCheck(
    @Query('creditCode') creditCode?: string,
    @Query('uniqueIdentifier') uniqueIdentifier?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const raw = uniqueIdentifier?.trim() || creditCode?.trim();
    if (!raw) {
      throw new BadRequestException('uniqueIdentifier 不能为空');
    }
    return this.clientsService.checkDuplicate(raw, user!);
  }

  /**
   * 新增客户向导草稿（每用户 1 槽）。须声明在 `:id` 之前。
   * 与 Client 主数据解耦：不进列表、不做建档强校验、不存证件文件。
   * meta：进页轻量探测（不拉 payload）；完整 GET 仅在「复原」时使用。
   */
  @Get('wizard-draft/meta')
  async getWizardDraftMeta(@CurrentUser() user: AuthenticatedUser) {
    return this.wizardDraftService.getMeta(user);
  }

  @Get('wizard-draft')
  async getWizardDraft(@CurrentUser() user: AuthenticatedUser) {
    return this.wizardDraftService.get(user);
  }

  @Put('wizard-draft')
  async saveWizardDraft(@Body() dto: SaveWizardDraftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.wizardDraftService.save(user, dto.payload);
  }

  @Delete('wizard-draft')
  async deleteWizardDraft(@CurrentUser() user: AuthenticatedUser) {
    return this.wizardDraftService.remove(user);
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

  /**
   * 编辑代理信息：country 锁定不可变更，agentCompany/agentYears/expectedEffectiveDate/shops 可编辑。
   * 保存不触发证书重新生成，用户需手动点击"重新生成"。
   */
  @Patch(':id/agent-infos/:agentInfoId')
  async updateAgentInfo(
    @Param('id') id: string,
    @Param('agentInfoId') agentInfoId: string,
    @Body() dto: UpdateAgentInfoDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clientsService.updateAgentInfo(id, agentInfoId, dto, user, meta);
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
