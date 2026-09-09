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
  ) {
    const out = await this.notifications.list(user, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    return out;
  }

  @Patch('read-all')
  async readAll(@CurrentUser() user: AuthUser | undefined) {
    const out = await this.notifications.markAllRead(user);
    return out;
  }

  @Patch(':id/read')
  async readOne(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const { id: parsed } = markReadSchema.parse({ id });
    const out = await this.notifications.markRead(user, parsed);
    return out;
  }
}

