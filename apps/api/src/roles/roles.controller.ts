import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { LoginStatus, UserRole } from '../common/enums';
import { RequireFeatures } from '../auth/decorators/features.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeaturesGuard } from '../auth/guards/features.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RolesService } from './roles.service';

const createRoleSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  baseRole: z.enum(['ADMIN', 'SUPPORT', 'DESIGNER']),
  permissions: z.record(z.string(), z.boolean()).default({}),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  baseRole: z.enum(['ADMIN', 'SUPPORT', 'DESIGNER']).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
  firstName: z.string().max(120).optional().nullable(),
  lastName: z.string().max(120).optional().nullable(),
  phone: z.string().max(60).optional().nullable(),
  role: z.enum(['ADMIN', 'SUPPORT', 'DESIGNER']).optional(),
  customRoleId: z.string().min(1).optional().nullable(),
  loginStatus: z
    .enum([LoginStatus.ACTIVE, LoginStatus.DISABLED, LoginStatus.PENDING])
    .optional(),
});

const updateUserSchema = z.object({
  firstName: z.string().max(120).optional().nullable(),
  lastName: z.string().max(120).optional().nullable(),
  phone: z.string().max(60).optional().nullable(),
  role: z.enum(['ADMIN', 'SUPPORT', 'DESIGNER']).optional(),
  customRoleId: z.string().min(1).optional().nullable(),
  loginStatus: z
    .enum([LoginStatus.ACTIVE, LoginStatus.DISABLED, LoginStatus.PENDING])
    .optional(),
  password: z.string().min(6).max(200).optional(),
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, FeaturesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
@RequireFeatures('roles')
export class RolesController {
  constructor(private roles: RolesService) {}

  @Get('roles/features')
  features() {
    return { features: this.roles.featureCatalog() };
  }

  @Get('roles')
  async listRoles() {
    return { roles: await this.roles.listRoles() };
  }

  @Post('roles')
  async createRole(@Body() body: unknown) {
    const data = createRoleSchema.parse(body);
    return { role: await this.roles.createRole(data) };
  }

  @Patch('roles/:id')
  async updateRole(@Param('id') id: string, @Body() body: unknown) {
    const data = updateRoleSchema.parse(body);
    return { role: await this.roles.updateRole(id, data) };
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string) {
    return this.roles.deleteRole(id);
  }

  @Get('users')
  async listUsers(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const result = await this.roles.listUsers({
      q: q?.trim() || undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    return { users: result.items, ...result };
  }

  @Post('users')
  async createUser(@Body() body: unknown) {
    const data = createUserSchema.parse(body);
    return { user: await this.roles.createUser(data) };
  }

  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() body: unknown) {
    const data = updateUserSchema.parse(body);
    return { user: await this.roles.updateUser(id, data) };
  }
}
