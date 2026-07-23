import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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

const messageSchema = z.object({
  body: z.string().min(1),
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
  async sendMessage(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = messageSchema.parse(body);
    return this.messaging.addMyMessage(user, id, data.body);
  }
}
