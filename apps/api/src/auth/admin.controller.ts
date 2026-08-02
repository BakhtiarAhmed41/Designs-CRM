import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { LoginStatus, UserRole } from '../common/enums';
import { Roles } from './decorators/roles.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './auth.service';

const statusSchema = z.object({
  status: z.enum([LoginStatus.ACTIVE, LoginStatus.DISABLED, LoginStatus.PENDING]),
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private auth: AuthService) {}

  @Get('ping')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  ping() {
    return { ok: true };
  }

  @Get('login-requests')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT)
  async listLoginRequests() {
    const requests = await this.auth.listPendingClients();
    return { requests };
  }

  @Patch('login-requests/:userId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async setLoginStatus(@Param('userId') userId: string, @Body() body: unknown) {
    const { status } = statusSchema.parse(body);
    return this.auth.setClientLoginStatus(userId, status);
  }

  @Delete('login-requests/:userId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async deleteLoginRequest(@Param('userId') userId: string) {
    return this.auth.deletePendingClient(userId);
  }
}
