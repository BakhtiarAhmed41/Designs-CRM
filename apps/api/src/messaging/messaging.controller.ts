import {
  Body,
  Controller,
  Get,
  Param,
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
import { MessageLabel } from '../common/enums';
import { MessagingService } from './messaging.service';

const labelSchema = z.enum([
  MessageLabel.EDIT,
  MessageLabel.PAYMENT,
  MessageLabel.CUSTOM,
  MessageLabel.IMPORTANT,
]);

const createConversationSchema = z.object({
  subject: z.string().max(255).optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  label: labelSchema.optional().nullable(),
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

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const conversation = await this.messaging.getMyConversation(user, id);
    return { conversation };
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
    return this.messaging.addMyMessage(
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
}
