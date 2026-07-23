import { Module } from '@nestjs/common';
import {
  AdminTeamController,
  MePresenceController,
} from './team.controller';
import { TeamService } from './team.service';

@Module({
  controllers: [AdminTeamController, MePresenceController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
