import { Module } from '@nestjs/common';
import { AdminEditsController } from './admin-edits.controller';
import { EditsController } from './edits.controller';
import { EditsService } from './edits.service';

@Module({
  controllers: [AdminEditsController, EditsController],
  providers: [EditsService],
})
export class EditsModule {}
