import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OcrService, type UploadedFileLike } from './ocr.service';

@Controller('ocr')
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  @Post('business-license')
  @UseInterceptors(FileInterceptor('file'))
  async businessLicense(@UploadedFile() file?: UploadedFileLike) {
    if (!file) {
      throw new BadRequestException('请上传营业执照图片');
    }
    return this.ocrService.recognizeBusinessLicense(file);
  }

  @Post('id-card')
  @UseInterceptors(FileInterceptor('file'))
  async idCard(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Query('side') side: 'front' | 'back' = 'front',
  ) {
    if (!file) {
      throw new BadRequestException('请上传身份证图片');
    }
    return this.ocrService.recognizeIdCard(file, side);
  }
}
