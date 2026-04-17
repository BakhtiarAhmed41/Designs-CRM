import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { OrdersService } from './orders.service';

const createOrderSchema = z.object({
  serviceType: z.string().min(1),
  instructions: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  preferences: z.any().optional(),
});

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser | undefined, @Body() body: unknown) {
    const data = createOrderSchema.parse(body);
    const order = await this.orders.createOrder(user, data);
    return { order };
  }

  @Get()
  async listMine(@CurrentUser() user: AuthUser | undefined) {
    const orders = await this.orders.listMyOrders(user);
    return { orders };
  }

  @Get(':id')
  async getMine(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const order = await this.orders.getMyOrder(user, id);
    return { order };
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file (Phase 1 default)
    }),
  )
  async uploadAttachments(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const attachments = await this.orders.uploadOrderAttachments(user, id, files);
    return { attachments };
  }

  @Get(':id/attachments/:attachmentId/signed-url')
  async getAttachmentSignedUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') orderId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.orders.getMyAttachmentSignedUrl(user, orderId, attachmentId);
  }

  @Get(':id/delivery-files/:deliveryFileId/signed-url')
  async getDeliveryFileSignedUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') orderId: string,
    @Param('deliveryFileId') deliveryFileId: string,
  ) {
    return this.orders.getMyDeliveryFileSignedUrl(user, orderId, deliveryFileId);
  }
}

