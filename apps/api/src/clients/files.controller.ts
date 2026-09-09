import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ClientsService } from './clients.service';
import { FILE_STORAGE, type FileStorageService } from '../storage/file-storage.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

/**
 * 证件图片鉴权下载接口，见 docs/client-batch-import-design.md 第 5.1 节：
 * 不用 `express.static` 直接暴露 `UPLOAD_DIR`，而是先校验当前用户对该 clientId 有访问权限
 * （复用 `ClientsService.findOne` 内的 `assertAccess` 逻辑），再读文件返回。
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly clientsService: ClientsService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorageService,
  ) {}

  @Get('clients/:clientId/:fileName')
  async download(
    @Param('clientId') clientId: string,
    @Param('fileName') fileName: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    // 权限校验：无权访问或客户不存在会在这里抛出异常
    await this.clientsService.findOne(clientId, user);
    const { buffer, mimetype } = await this.fileStorage.read(`clients/${clientId}/${fileName}`);
    if (mimetype) {
      res.set('Content-Type', mimetype);
    }
    res.send(buffer);
  }
}
