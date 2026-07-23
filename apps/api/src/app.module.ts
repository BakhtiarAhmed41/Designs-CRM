import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BillingModule } from './billing/billing.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DbModule } from './db/db.module';
import { EditsModule } from './edits/edits.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { SearchModule } from './search/search.module';
import { StorageModule } from './storage/storage.module';
import { TeamModule } from './team/team.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    DbModule,
    StorageModule,
    AuthModule,
    UsersModule,
    OrdersModule,
    NotificationsModule,
    MessagingModule,
    SearchModule,
    BillingModule,
    CustomersModule,
    TeamModule,
    EditsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
