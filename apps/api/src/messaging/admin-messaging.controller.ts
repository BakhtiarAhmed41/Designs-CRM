import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeatures } from '../auth/decorators/features.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeaturesGuard } from '../auth/guards/features.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ChatType,
  ConversationStatus,
  MessageLabel,
  STAFF_ROLES,
} from '../common/enums';
import { MessagingService } from './messaging.service';

const labelSchema = z.enum([
  MessageLabel.EDIT,
  MessageLabel.PAYMENT,
  MessageLabel.CUSTOM,
  MessageLabel.IMPORTANT,
]);

const chatTypeSchema = z.enum([
  ChatType.GENERAL,
  ChatType.ORDER,
  ChatType.QUOTE,
]);

const statusSchema = z.enum([
  ConversationStatus.OPEN,
  ConversationStatus.CLOSED,
]);

const createConversationSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  subject: z.string().max(255).optional().nullable(),
  label: labelSchema.optional().nullable(),
  chatType: chatTypeSchema.optional(),
});

const updateConversationSchema = z
  .object({
    label: labelSchema.nullable().optional(),
    subject: z.string().max(255).nullable().optional(),
    archived: z.boolean().optional(),
    privateNotes: z.string().nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine(
    (v) =>
      v.label !== undefined ||
      v.subject !== undefined ||
      v.archived !== undefined ||
      v.privateNotes !== undefined ||
      v.status !== undefined,
    { message: 'Nothing to update' },
  );

const templateSchema = z.object({
  title: z.string().min(1).max(150),
  body: z.string().min(1),
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, FeaturesGuard)
@Roles(...STAFF_ROLES)
export class AdminMessagingController {
  constructor(private messaging: MessagingService) {}

  @Get('conversations')
  @RequireFeatures('messages', 'messages_customer_view')
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('label') label: string | undefined,
    @Query('q') q: string | undefined,
    @Query('archived') archived: string | undefined,
    @Query('unread') unread: string | undefined,
    @Query('read') read: string | undefined,
    @Query('status') status: string | undefined,
    @Query('chatType') chatType: string | undefined,
    @Query('customerId') customerId: string | undefined,
  ) {
    const conversations = await this.messaging.listAdminConversations(user, {
      label: label || undefined,
      q: q || undefined,
      archived: archived === '1' || archived === 'true',
      unread: unread === '1' || unread === 'true',
      read: read === '1' || read === 'true',
      status: statusSchema.safeParse(status).success
        ? (status as ConversationStatus)
        : undefined,
      chatType: chatTypeSchema.safeParse(chatType).success
        ? (chatType as ChatType)
        : undefined,
      customerId: customerId || undefined,
    });
    return { conversations };
  }

  @Get('conversations/unread-summary')
  @RequireFeatures('messages', 'messages_customer_view')
  async unreadSummary(@CurrentUser() user: AuthUser | undefined) {
    return this.messaging.adminUnreadSummary(user);
  }

  @Get('customers/:customerId/messaging-context')
  @RequireFeatures('messages', 'messages_customer_view')
  async customerContext(
    @CurrentUser() user: AuthUser | undefined,
    @Param('customerId') customerId: string,
  ) {
    return this.messaging.getCustomerMessagingContext(user, customerId);
  }

  @Get('conversations/:id')
  @RequireFeatures('messages', 'messages_customer_view')
  async get(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const conversation = await this.messaging.getAdminConversation(user, id);
    return { conversation };
  }

  @Post('conversations')
  @RequireFeatures('messages', 'messages_customer_start')
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = createConversationSchema.parse(body);
    const conversation = await this.messaging.createAdminConversation(
      user,
      data,
    );
    return { conversation };
  }

  @Post('conversations/:id/messages')
  @RequireFeatures('messages', 'messages_customer_reply')
  @UseInterceptors(
    FilesInterceptor('files', 8, {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async sendMessage(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: { body?: string; replyToMessageId?: string },
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.messaging.addAdminMessage(
      user,
      id,
      body.body ?? '',
      (files ?? []).map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        buffer: f.buffer,
      })),
      body.replyToMessageId ?? null,
    );
  }

  @Patch('conversations/:id')
  @RequireFeatures('messages', 'messages_customer_view')
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

  @Delete('messages/:id')
  @RequireFeatures('messages_delete')
  async deleteMessage(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.messaging.softDeleteMessage(user, id);
  }

  @Get('message-templates')
  @RequireFeatures('messages', 'messages_customer_reply')
  async listTemplates(@CurrentUser() user: AuthUser | undefined) {
    const templates = await this.messaging.listTemplates(user);
    return { templates };
  }

  @Post('message-templates')
  @RequireFeatures('messages', 'messages_customer_reply')
  async createTemplate(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = templateSchema.parse(body);
    const template = await this.messaging.createTemplate(user, data);
    return { template };
  }

  @Delete('message-templates/:id')
  @RequireFeatures('messages', 'messages_customer_reply')
  async deleteTemplate(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.messaging.deleteTemplate(user, id);
  }
}
