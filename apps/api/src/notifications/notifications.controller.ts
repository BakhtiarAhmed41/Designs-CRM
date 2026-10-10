import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

const markReadSchema = z.object({
  id: z.string().uuid(),
});

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('dismissed') dismissed?: string,
  ) {
    return this.notifications.list(user, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      dismissed: dismissed === '1' || dismissed === 'true',
    });
  }

  @Patch('read-all')
  async readAll(@CurrentUser() user: AuthUser | undefined) {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  async readOne(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const { id: parsed } = markReadSchema.parse({ id });
    return this.notifications.markRead(user, parsed);
  }

  @Patch(':id/dismiss')
  async dismiss(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const { id: parsed } = markReadSchema.parse({ id });
    return this.notifications.dismiss(user, parsed);
  }

  @Patch(':id/restore')
  async restore(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const { id: parsed } = markReadSchema.parse({ id });
    return this.notifications.restore(user, parsed);
  }
}
