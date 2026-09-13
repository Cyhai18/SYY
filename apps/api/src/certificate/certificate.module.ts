import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { CertificateController } from './certificate.controller';
import { CertificateProcessor } from './certificate.processor';

@Module({
  controllers: [CertificateController],
  providers: [CertificateService, CertificateProcessor],
})
export class CertificateModule {}
