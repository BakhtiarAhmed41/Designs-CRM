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
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MessageLabel, STAFF_ROLES } from '../common/enums';
import { MessagingService } from './messaging.service';

const labelSchema = z.enum([
  MessageLabel.EDIT,
  MessageLabel.PAYMENT,
  MessageLabel.CUSTOM,
  MessageLabel.IMPORTANT,
]);

const createConversationSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  subject: z.string().max(255).optional().nullable(),
  label: labelSchema.optional().nullable(),
});

const messageSchema = z.object({
  body: z.string().min(1),
});

const updateConversationSchema = z
  .object({
    label: labelSchema.nullable().optional(),
    subject: z.string().max(255).nullable().optional(),
    archived: z.boolean().optional(),
    privateNotes: z.string().nullable().optional(),
  })
  .refine(
    (v) =>
      v.label !== undefined ||
      v.subject !== undefined ||
      v.archived !== undefined ||
      v.privateNotes !== undefined,
    { message: 'Nothing to update' },
  );

const templateSchema = z.object({
  title: z.string().min(1).max(150),
  body: z.string().min(1),
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminMessagingController {
  constructor(private messaging: MessagingService) {}

  @Get('conversations')
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('label') label: string | undefined,
    @Query('q') q: string | undefined,
    @Query('archived') archived: string | undefined,
  ) {
    const conversations = await this.messaging.listAdminConversations(user, {
      label: label || undefined,
      q: q || undefined,
      archived: archived === '1' || archived === 'true',
    });
    return { conversations };
  }

  @Get('conversations/:id')
  async get(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const conversation = await this.messaging.getAdminConversation(user, id);
    return { conversation };
  }

  @Post('conversations')
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = createConversationSchema.parse(body);
    const conversation = await this.messaging.createAdminConversation(user, data);
    return { conversation };
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = messageSchema.parse(body);
    return this.messaging.addAdminMessage(user, id, data.body);
  }

  @Patch('conversations/:id')
  async update(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = updateConversationSchema.parse(body);
    const conversation = await this.messaging.updateAdminConversation(
      user,
      id,
      data,
    );
    return { conversation };
  }

  @Get('message-templates')
  async listTemplates(@CurrentUser() user: AuthUser | undefined) {
    const templates = await this.messaging.listTemplates(user);
    return { templates };
  }

  @Post('message-templates')
  async createTemplate(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = templateSchema.parse(body);
    const template = await this.messaging.createTemplate(user, data);
    return { template };
  }

  @Delete('message-templates/:id')
  async deleteTemplate(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.messaging.deleteTemplate(user, id);
  }
}
