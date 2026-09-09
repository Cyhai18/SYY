import { Module } from '@nestjs/common';
import { FILE_STORAGE } from './file-storage.service';
import { LocalDiskProvider } from './providers/local-disk.provider';

@Module({
  providers: [{ provide: FILE_STORAGE, useClass: LocalDiskProvider }],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
