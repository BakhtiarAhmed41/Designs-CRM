import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AdminBillingController } from './admin-billing.controller';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PayLinkController } from './pay-link.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [NotificationsModule, StorageModule],
  controllers: [
    AdminBillingController,
    BillingController,
    PayLinkController,
    StripeWebhookController,
  ],
  providers: [BillingService, StripeService],
  exports: [BillingService, StripeService],
})
export class BillingModule {}
