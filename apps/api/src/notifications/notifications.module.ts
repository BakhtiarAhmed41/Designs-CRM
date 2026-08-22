import { Module } from '@nestjs/common';
import { NotificationEvents } from './notification.events';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEvents],
  exports: [NotificationsService, NotificationEvents],
})
export class NotificationsModule {}
