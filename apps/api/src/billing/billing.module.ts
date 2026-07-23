import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminBillingController } from './admin-billing.controller';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PayLinkController } from './pay-link.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminBillingController, BillingController, PayLinkController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
