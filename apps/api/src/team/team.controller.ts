import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Presence, STAFF_ROLES, UserRole } from '../common/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { TeamService } from './team.service';

const STAFF_ROLE_VALUES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
  UserRole.DESIGNER,
] as const;

const createSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  role: z.enum(STAFF_ROLE_VALUES),
  firstName: z.string().min(1).max(120).optional().nullable(),
  skills: z.array(z.string().min(1).max(60)).optional(),
});

const updateSchema = z.object({
  role: z.enum(STAFF_ROLE_VALUES).optional(),
  firstName: z.string().min(1).max(120).optional().nullable(),
  lastName: z.string().min(1).max(120).optional().nullable(),
  skills: z.array(z.string().min(1).max(60)).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  presence: z.nativeEnum(Presence).optional(),
});

const presenceSchema = z.object({
  presence: z.nativeEnum(Presence),
});

const staffChatSchema = z.object({
  body: z.string().min(1).max(5000),
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminTeamController {
  constructor(private team: TeamService) {}

  @Get('team')
  async list() {
    const members = await this.team.list();
    return { members };
  }

  @Post('team')
  @Roles(UserRole.ADMIN)
  async create(@Body() body: unknown) {
    const data = createSchema.parse(body);
    const member = await this.team.create(data);
    return { member };
  }

  @Patch('team/:id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: unknown) {
    const data = updateSchema.parse(body);
    const member = await this.team.update(id, data);
    return { member };
  }

  @Get('mywork')
  async myWork(@CurrentUser() user: AuthUser) {
    const orders = await this.team.myWork(user.id);
    return { orders };
  }

  @Post('team/:userId/assign/:orderId')
  @Roles(UserRole.ADMIN)
  async assign(
    @Param('userId') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.team.assignOrder(userId, orderId);
  }

  @Get('team-chat/:peerId')
  async listChat(
    @CurrentUser() user: AuthUser,
    @Param('peerId') peerId: string,
  ) {
    return this.team.listStaffChat(user.id, peerId);
  }

  @Post('team-chat/:peerId')
  async sendChat(
    @CurrentUser() user: AuthUser,
    @Param('peerId') peerId: string,
    @Body() body: unknown,
  ) {
    const { body: text } = staffChatSchema.parse(body);
    return this.team.sendStaffChat(user.id, peerId, text);
  }

  @Get('team-chat-owner')
  async ownerPeer(@CurrentUser() user: AuthUser) {
    const ownerId = await this.team.resolveOwnerId();
    if (!ownerId || ownerId === user.id) return { peerId: null };
    return { peerId: ownerId };
  }
}

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MePresenceController {
  constructor(private team: TeamService) {}

  @Patch('presence')
  async setPresence(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { presence } = presenceSchema.parse(body);
    const member = await this.team.setPresence(user.id, presence);
    return { member };
  }
}
