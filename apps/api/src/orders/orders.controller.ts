import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Patch,
  Query,
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
import { OrderStatus, OrderType } from '../common/enums';

const createOrderSchema = z.object({
  type: z.enum(['ORDER', 'QUOTE_REQUEST', 'QUOTATION_REQUEST']).optional(),
  name: z.string().optional().nullable(),
  mainCategory: z.string().optional().nullable(),
  subCategory: z.string().optional().nullable(),
  serviceType: z.string().min(1),
  instructions: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  preferences: z.any().optional(),
  turnaroundKey: z.string().optional().nullable(),
});

const draftSchema = z.object({
  serviceKey: z.string().min(1),
  payload: z.any(),
});

const formatRequestSchema = z.object({
  format: z.string().min(1).max(60),
  deliveryFileId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

const acceptQuotationSchema = z.object({
  keepLineIds: z.array(z.string().min(1)).optional().nullable(),
});

const rejectQuotationSchema = z.object({
  comment: z.string().optional().nullable(),
});

const counterQuotationSchema = z.object({
  amountCents: z.number().int().positive().optional().nullable(),
  currency: z.string().min(1).optional().nullable(),
  comment: z.string().optional().nullable(),
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
  async listMine(
    @CurrentUser() user: AuthUser | undefined,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('lifecycle') lifecycle?: string,
    @Query('q') q?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const types = Object.values(OrderType) as string[];
    const statuses = Object.values(OrderStatus) as string[];
    const result = await this.orders.listMyOrders(user, {
      type: type && types.includes(type) ? (type as OrderType) : undefined,
      status: status && statuses.includes(status) ? (status as OrderStatus) : undefined,
      lifecycle:
        lifecycle === 'active' || lifecycle === 'delivered' ? lifecycle : undefined,
      q: q?.trim() || undefined,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    return {
      orders: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      delivered: result.delivered,
      totalCents: result.totalCents,
      designs: result.designs,
    };
  }

  @Get('summary')
  async mySummary(@CurrentUser() user: AuthUser | undefined) {
    return this.orders.myOrderSummary(user);
  }

  @Get('my-files')
  async myFiles(@CurrentUser() user: AuthUser | undefined) {
    const files = await this.orders.listMyFiles(user);
    return { files };
  }

  @Get('drafts')
  async listDrafts(@CurrentUser() user: AuthUser | undefined) {
    return this.orders.listQuoteDrafts(user);
  }

  @Get('drafts/:serviceKey')
  async getDraft(
    @CurrentUser() user: AuthUser | undefined,
    @Param('serviceKey') serviceKey: string,
  ) {
    return this.orders.getQuoteDraft(user, serviceKey);
  }

  @Put('drafts/:serviceKey')
  async saveDraft(
    @CurrentUser() user: AuthUser | undefined,
    @Param('serviceKey') serviceKey: string,
    @Body() body: unknown,
  ) {
    const data = draftSchema.omit({ serviceKey: true }).parse(body ?? {});
    return this.orders.saveQuoteDraft(user, serviceKey, data.payload);
  }

  @Post('intents/:token/claim')
  async claimIntent(
    @CurrentUser() user: AuthUser | undefined,
    @Param('token') token: string,
  ) {
    return this.orders.claimQuoteIntent(user, token);
  }

  @Post(':id/format-requests')
  async requestFormat(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = formatRequestSchema.parse(body);
    return this.orders.requestFormat(user, id, data);
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

  @Patch(':id/quotations/accept')
  async acceptQuotation(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') orderId: string,
    @Body() body: unknown,
  ) {
    const data = acceptQuotationSchema.parse(body ?? {});
    const order = await this.orders.clientAcceptQuotation(user, orderId, data);
    return { order };
  }

  @Patch(':id/quotations/reject')
  async rejectQuotation(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') orderId: string,
    @Body() body: unknown,
  ) {
    const data = rejectQuotationSchema.parse(body);
    const order = await this.orders.clientRejectQuotation(user, orderId, data);
    return { order };
  }

  @Post(':id/quotations/counter')
  async counterQuotation(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') orderId: string,
    @Body() body: unknown,
  ) {
    const data = counterQuotationSchema.parse(body);
    const quotation = await this.orders.clientCounterQuotation(user, orderId, data);
    const order = await this.orders.getMyOrder(user, orderId);
    return { quotation, order };
  }
}

