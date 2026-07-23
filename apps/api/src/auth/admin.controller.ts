import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '../common/enums';
import { Roles } from './decorators/roles.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Get('ping')
  @Roles(UserRole.ADMIN)
  ping() {
    return { ok: true };
  }
}

