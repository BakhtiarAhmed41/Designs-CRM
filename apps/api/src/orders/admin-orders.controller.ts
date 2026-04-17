import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { OrderStatus, UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrdersService } from './orders.service';

const rejectSchema = z.object({
  reason: z.string().min(1),
});

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOrdersController {
  constructor(private orders: OrdersService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('status') status: string | undefined,
    @Query('clientId') clientId: string | undefined,
  ) {
    const parsedStatus = status ? z.nativeEnum(OrderStatus).parse(status) : undefined;
    const orders = await this.orders.listAdminOrders(user, {
      status: parsedStatus,
      clientId: clientId || undefined,
    });
    return { orders };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const order = await this.orders.getAdminOrder(user, id);
    return { order };
  }

  @Patch(':id/approve')
  async approve(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const order = await this.orders.approveOrder(user, id);
    return { order };
  }

  @Patch(':id/reject')
  async reject(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = rejectSchema.parse(body);
    const order = await this.orders.rejectOrder(user, id, reason);
    return { order };
  }

  @Post(':id/deliveries')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // allow larger deliverables
    }),
  )
  async deliver(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.orders.deliverOrder(user, id, files);
  }

  @Get(':id/attachments/:attachmentId/signed-url')
  async getAttachmentSignedUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') orderId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.orders.getAdminAttachmentSignedUrl(user, orderId, attachmentId);
  }

  @Get(':id/delivery-files/:deliveryFileId/signed-url')
  async getDeliveryFileSignedUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') orderId: string,
    @Param('deliveryFileId') deliveryFileId: string,
  ) {
    return this.orders.getAdminDeliveryFileSignedUrl(user, orderId, deliveryFileId);
  }
}

