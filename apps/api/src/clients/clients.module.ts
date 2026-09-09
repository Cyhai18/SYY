import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { FilesController } from './files.controller';
import { StorageModule } from '../storage/storage.module';
import { OcrModule } from '../ocr/ocr.module';
import { ZipExtractorService } from './import/zip-extractor.service';
import { ExcelParserService } from './import/excel-parser.service';
import { RowValidatorService } from './import/row-validator.service';
import { ClientImportProcessor } from './import/client-import.processor';
import { ClientImportController } from './import/client-import.controller';

@Module({
  imports: [StorageModule, OcrModule],
  // ClientImportController 必须先于 ClientsController 注册：否则 GET /clients/:id 会先匹配掉
  // GET/PATCH /clients/import 等路径（Nest 按控制器/装饰器注册顺序做路由匹配，无自动按具体度排序）。
  controllers: [ClientImportController, ClientsController, FilesController],
  providers: [
    ClientsService,
    ZipExtractorService,
    ExcelParserService,
    RowValidatorService,
    ClientImportProcessor,
  ],
  exports: [ClientsService, ZipExtractorService, ExcelParserService, RowValidatorService],
})
export class ClientsModule {}
