import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminMessagingController } from './admin-messaging.controller';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminMessagingController, MessagingController],
  providers: [MessagingService],
})
export class MessagingModule {}
