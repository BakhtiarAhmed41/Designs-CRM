import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalStorageService } from './local-storage.service';

@Module({
  controllers: [FilesController],
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class StorageModule {}
