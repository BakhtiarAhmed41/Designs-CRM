import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BillingModule } from '../billing/billing.module';
import { EditsModule } from '../edits/edits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersController } from './orders.controller';
import { PublicQuotesController } from './public-quotes.controller';
import { OrderRefInterceptor } from './order-ref.interceptor';
import { OrdersService } from './orders.service';

@Module({
  imports: [StorageModule, NotificationsModule, BillingModule, EditsModule],
  controllers: [OrdersController, AdminOrdersController, PublicQuotesController],
  providers: [
    OrdersService,
    { provide: APP_INTERCEPTOR, useClass: OrderRefInterceptor },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
