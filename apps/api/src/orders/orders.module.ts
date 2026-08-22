import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersController } from './orders.controller';
import { PublicQuotesController } from './public-quotes.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StorageModule, NotificationsModule, BillingModule],
  controllers: [OrdersController, AdminOrdersController, PublicQuotesController],
  providers: [OrdersService],
})
export class OrdersModule {}
