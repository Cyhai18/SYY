import { Module } from '@nestjs/common';
import { OcrService, OCR_PROVIDER } from './ocr.service';
import { OcrController } from './ocr.controller';
import { RapidOcrProvider } from './providers/rapid-ocr.provider';

@Module({
  controllers: [OcrController],
  providers: [OcrService, { provide: OCR_PROVIDER, useClass: RapidOcrProvider }],
  exports: [OcrService],
})
export class OcrModule {}
