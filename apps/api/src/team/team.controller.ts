import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { Presence, STAFF_ROLES, UserRole } from '../common/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeatures } from '../auth/decorators/features.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeaturesGuard } from '../auth/guards/features.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { MESSAGE_UPLOAD, mapMulterFiles } from '../common/multer-errors';
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

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, FeaturesGuard)
@Roles(...STAFF_ROLES)
export class AdminTeamController {
  constructor(private team: TeamService) {}

  @Get('team')
  @RequireFeatures(
    'team',
    'orders',
    'quotes',
    'edits',
    'messages',
    'messages_team_view',
  )
  async list() {
    const members = await this.team.list();
    return { members };
  }

  @Post('team')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequireFeatures('team')
  async create(@Body() body: unknown) {
    const data = createSchema.parse(body);
    const member = await this.team.create(data);
    return { member };
  }

  @Patch('team/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequireFeatures('team')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const data = updateSchema.parse(body);
    const member = await this.team.update(id, data);
    return { member };
  }

  @Get('mywork')
  @RequireFeatures('orders')
  async myWork(@CurrentUser() user: AuthUser) {
    const orders = await this.team.myWork(user.id);
    return { orders };
  }

  @Post('team/:userId/assign/:orderId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequireFeatures('team')
  async assign(
    @Param('userId') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.team.assignOrder(userId, orderId);
  }

  @Post('team/unassign/:orderId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequireFeatures('team')
  async unassign(@Param('orderId') orderId: string) {
    return this.team.unassignOrder(orderId);
  }

  @Get('team-chat/unread-summary')
  @RequireFeatures('messages', 'messages_team_view')
  async teamUnread(@CurrentUser() user: AuthUser) {
    return this.team.teamUnreadSummary(user.id);
  }

  @Get('team-chat/recent')
  @RequireFeatures('messages', 'messages_team_view')
  async recentTeamChats(@CurrentUser() user: AuthUser) {
    return this.team.recentTeamConversations(user.id);
  }

  @Get('team-chat/:peerId')
  @RequireFeatures('messages', 'messages_team_view')
  async listChat(
    @CurrentUser() user: AuthUser,
    @Param('peerId') peerId: string,
  ) {
    return this.team.listStaffChat(user.id, peerId);
  }

  @Post('team-chat/:peerId')
  @RequireFeatures('messages', 'messages_team_send')
  @UseInterceptors(
    FilesInterceptor('files', MESSAGE_UPLOAD.maxFiles, {
      storage: memoryStorage(),
      limits: { fileSize: MESSAGE_UPLOAD.maxFileSize },
    }),
  )
  async sendChat(
    @CurrentUser() user: AuthUser,
    @Param('peerId') peerId: string,
    @Body() body: { body?: string } | undefined,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.team.sendStaffChat(
      user.id,
      peerId,
      body?.body ?? '',
      mapMulterFiles(files),
    );
  }

  @Post('team-chat/:peerId/read')
  @RequireFeatures('messages', 'messages_team_view')
  async markDmRead(
    @CurrentUser() user: AuthUser,
    @Param('peerId') peerId: string,
  ) {
    return this.team.markStaffChatRead(user.id, peerId);
  }

  @Get('team-chat-owner')
  @RequireFeatures('messages', 'messages_team_view')
  async ownerPeer(@CurrentUser() user: AuthUser) {
    const ownerId = await this.team.resolveOwnerId();
    if (!ownerId || ownerId === user.id) return { peerId: null };
    return { peerId: ownerId };
  }

  @Get('team-group-chat')
  @RequireFeatures('messages', 'messages_group', 'messages_team_view')
  async listGroupChat(@CurrentUser() user: AuthUser) {
    return this.team.listGroupChat(user.id);
  }

  @Post('team-group-chat')
  @RequireFeatures('messages', 'messages_group', 'messages_team_send')
  @UseInterceptors(
    FilesInterceptor('files', MESSAGE_UPLOAD.maxFiles, {
      storage: memoryStorage(),
      limits: { fileSize: MESSAGE_UPLOAD.maxFileSize },
    }),
  )
  async sendGroupChat(
    @CurrentUser() user: AuthUser,
    @Body() body: { body?: string } | undefined,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.team.sendGroupChat(
      user.id,
      body?.body ?? '',
      mapMulterFiles(files),
    );
  }

  @Post('team-group-chat/read')
  @RequireFeatures('messages', 'messages_group', 'messages_team_view')
  async markGroupRead(@CurrentUser() user: AuthUser) {
    return this.team.markGroupChatRead(user.id);
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
