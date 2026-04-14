import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { UsersService } from './users.service';

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(80).optional().nullable(),
  lastName: z.string().min(1).max(80).optional().nullable(),
  phone: z.string().min(3).max(30).optional().nullable(),
});

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.users.getById(user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto = updateProfileSchema.parse(body);
    return { user: await this.users.updateProfile(user.id, dto) };
  }
}

