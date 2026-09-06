import {
  Body,
  Controller,
  Delete,
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
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatType, MessageLabel } from '../common/enums';
import { MESSAGE_UPLOAD, mapMulterFiles } from '../common/multer-errors';
import { MessagingService } from './messaging.service';

const labelSchema = z.enum([
  MessageLabel.EDIT,
  MessageLabel.PAYMENT,
  MessageLabel.CUSTOM,
  MessageLabel.IMPORTANT,
  MessageLabel.HELP,
]);

const chatTypeSchema = z.enum([
  ChatType.GENERAL,
  ChatType.ORDER,
  ChatType.QUOTE,
]);

const createConversationSchema = z.object({
  subject: z.string().max(255).optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  label: labelSchema.optional().nullable(),
  chatType: chatTypeSchema.optional(),
});

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private messaging: MessagingService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser | undefined) {
    const conversations = await this.messaging.listMyConversations(user);
    return { conversations };
  }

  @Get('unread-summary')
  async unreadSummary(@CurrentUser() user: AuthUser | undefined) {
    return this.messaging.myUnreadSummary(user);
  }

  @Post('bulk')
  async bulk(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(50),
        action: z.enum(['delete', 'star', 'unstar']),
      })
      .parse(body);
    return this.messaging.bulkMyConversations(user, data);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = z
      .object({
        starred: z.boolean().optional(),
        label: z.literal(MessageLabel.HELP).optional(),
      })
      .refine((v) => v.starred !== undefined || v.label !== undefined, {
        message: 'Nothing to update',
      })
      .parse(body);
    const conversation = await this.messaging.updateMyConversation(user, id, data);
    return { conversation };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const conversation = await this.messaging.getMyConversation(user, id);
    return { conversation };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.messaging.deleteMyConversation(user, id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = createConversationSchema.parse(body);
    const conversation = await this.messaging.createMyConversation(user, data);
    return { conversation };
  }

  @Post(':id/messages')
  @UseInterceptors(
    FilesInterceptor('files', MESSAGE_UPLOAD.maxFiles, {
      storage: memoryStorage(),
      limits: { fileSize: MESSAGE_UPLOAD.maxFileSize },
    }),
  )
  async sendMessage(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: { body?: string; replyToMessageId?: string } | undefined,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.messaging.addMyMessage(
      user,
      id,
      body?.body ?? '',
      mapMulterFiles(files),
      body?.replyToMessageId ?? null,
    );
  }
}
