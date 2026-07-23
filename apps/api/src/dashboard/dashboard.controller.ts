import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums';
import { DashboardService } from './dashboard.service';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPPORT, UserRole.DESIGNER)
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('stats')
  async stats(@CurrentUser() user: AuthUser | undefined) {
    const stats = await this.dashboard.getStats(user);
    return { stats };
  }

  @Get('chart')
  async chart(
    @CurrentUser() user: AuthUser | undefined,
    @Query('days') days: string | undefined,
  ) {
    const parsed = days ? Number.parseInt(days, 10) : 14;
    const series = await this.dashboard.getChart(
      user,
      Number.isFinite(parsed) ? parsed : 14,
    );
    return { series };
  }
}
