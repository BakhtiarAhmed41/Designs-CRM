import { Module, forwardRef } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import {
  AdminTeamController,
  MePresenceController,
} from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [
    StorageModule,
    NotificationsModule,
    forwardRef(() => MessagingModule),
  ],
  controllers: [AdminTeamController, MePresenceController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
