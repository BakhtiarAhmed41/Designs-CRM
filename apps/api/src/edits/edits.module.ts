import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AdminEditsController } from './admin-edits.controller';
import { EditsController } from './edits.controller';
import { EditsService } from './edits.service';

@Module({
  imports: [BillingModule],
  controllers: [AdminEditsController, EditsController],
  providers: [EditsService],
  exports: [EditsService],
})
export class EditsModule {}
