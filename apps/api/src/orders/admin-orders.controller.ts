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
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import {
  CustomerSource,
  DeliveredVia,
  DesignStatus,
  OrderStatus,
  OrderType,
  STAFF_ROLES,
} from '../common/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeatures, RequireSupport } from '../auth/decorators/features.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeaturesGuard } from '../auth/guards/features.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrdersService } from './orders.service';

const rejectSchema = z.object({
  reason: z.string().min(1),
  status: z.enum([OrderStatus.REJECTED, OrderStatus.CANCELLED]).optional(),
});

const notesSchema = z.object({
  notes: z.string(),
});

const proposeQuotationSchema = z.object({
  amountCents: z.number().int().positive().optional().nullable(),
  currency: z.string().min(1).optional().nullable(),
  comment: z.string().optional().nullable(),
});

const counterDecisionSchema = z.object({
  comment: z.string().optional().nullable(),
});

const createDesignSchema = z.object({
  name: z.string().min(1),
  placement: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  priceCents: z.number().int().nonnegative().optional().nullable(),
  requestedFormats: z.array(z.string()).optional().nullable(),
});

const updateDesignSchema = z.object({
  name: z.string().min(1).optional().nullable(),
  placement: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  status: z
    .enum([
      DesignStatus.WAITING,
      DesignStatus.IN_PROGRESS,
      DesignStatus.DONE,
      DesignStatus.DELIVERED,
    ])
    .optional()
    .nullable(),
  priceCents: z.number().int().nonnegative().optional().nullable(),
});

const duplicateOrderSchema = z.object({
  sourceOrderId: z.string().min(1),
  type: z.enum([OrderType.ORDER, OrderType.QUOTE_REQUEST]).optional(),
});

const SOURCE_UI_TO_ENUM: Record<string, CustomerSource> = {
  PORTAL: CustomerSource.PORTAL,
  ETSY: CustomerSource.ETSY,
  GUEST: CustomerSource.GUEST,
  TEXT: CustomerSource.TEXT,
  TEXT_MESSAGE: CustomerSource.TEXT,
  WHATSAPP: CustomerSource.GUEST,
  PHONE: CustomerSource.GUEST,
  EMAIL: CustomerSource.GUEST,
  DIRECT: CustomerSource.GUEST,
};

const adminCreateOrderSchema = z
  .object({
    type: z.enum([OrderType.ORDER, OrderType.QUOTE_REQUEST]),
    customerId: z.string().min(1).optional().nullable(),
    customerName: z.string().min(1).optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    phone: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    serviceType: z.string().min(1),
    size: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    designCount: z.number().int().positive().optional().nullable(),
    priceCents: z.number().int().nonnegative().optional().nullable(),
    instructions: z.string().optional().nullable(),
    channel: z.string().optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (!val.customerId && !val.customerName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'customerName is required when customerId is not provided',
        path: ['customerName'],
      });
    }
  });

const updateStatusSchema = z.object({
  status: z.enum([
    OrderStatus.CREATED,
    OrderStatus.WAITING_FOR_QUOTATION,
    OrderStatus.QUOTATION_PROVIDED,
    OrderStatus.CLIENT_REJECTED_QUOTATION,
    OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL,
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.IN_PROGRESS,
    OrderStatus.READY_TO_SEND,
    OrderStatus.REVISION_REQUESTED,
    OrderStatus.COMPLETED,
    OrderStatus.CLOSED,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
  ]),
});

const quoteBuilderSchema = z.object({
  comment: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        name: z.string().min(1),
        note: z.string().optional().nullable(),
        attachmentId: z.string().optional().nullable(),
        priceCents: z.number().int().nonnegative().optional().nullable(),
        sizes: z
          .array(
            z.object({
              label: z.string().min(1),
              priceCents: z.number().int().nonnegative(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return defaultValue;
}

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard, FeaturesGuard)
@Roles(...STAFF_ROLES)
@RequireFeatures('orders', 'quotes')
export class AdminOrdersController {
  constructor(private orders: OrdersService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('status') status: string | undefined,
    @Query('statuses') statusesRaw: string | undefined,
    @Query('olderThanDays') olderThanDays: string | undefined,
    @Query('updatedOlderThanDays') updatedOlderThanDays: string | undefined,
    @Query('clientId') clientId: string | undefined,
    @Query('type') type: string | undefined,
    @Query('q') q: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ) {
    const statuses = Object.values(OrderStatus) as string[];
    const parsedStatus =
      status && statuses.includes(status)
        ? (status as OrderStatus)
        : undefined;
    const types = Object.values(OrderType) as string[];
    const parsedType =
      type && types.includes(type) ? (type as OrderType) : undefined;
    const parsedStatuses = (statusesRaw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => statuses.includes(s)) as OrderStatus[];
    const older = olderThanDays ? Number(olderThanDays) : undefined;
    const updatedOlder = updatedOlderThanDays ? Number(updatedOlderThanDays) : undefined;
    const result = await this.orders.listAdminOrders(user, {
      status: parsedStatus,
      statuses: parsedStatuses.length ? parsedStatuses : undefined,
      olderThanDays: Number.isFinite(older) ? older : undefined,
      updatedOlderThanDays: Number.isFinite(updatedOlder) ? updatedOlder : undefined,
      clientId: clientId || undefined,
      type: parsedType,
      q: q?.trim() || undefined,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      page: page ? Number(page) : undefined,
      // Keep a high default so dashboards/modals that omit pagination still see full lists.
      pageSize: pageSize ? Number(pageSize) : 500,
    });
    return {
      orders: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    };
  }

  @Get('format-requests')
  async formatRequests(
    @CurrentUser() user: AuthUser | undefined,
    @Query('orderId') orderId: string | undefined,
  ) {
    const requests = await this.orders.listFormatRequests(user, orderId);
    return { requests };
  }

  @Patch('format-requests/:requestId')
  async updateFormatRequest(
    @CurrentUser() user: AuthUser | undefined,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    const data = z
      .object({ status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED']) })
      .parse(body);
    return this.orders.updateFormatRequest(user, requestId, data.status);
  }

  @Post()
  async duplicate(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = duplicateOrderSchema.parse(body);
    const order = await this.orders.duplicateOrder(user, data);
    return { order };
  }

  @Post('create')
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = adminCreateOrderSchema.parse(body);
    const sourceKey = (data.source ?? 'GUEST').toUpperCase().replace(/\s+/g, '_');
    const source =
      SOURCE_UI_TO_ENUM[sourceKey] ??
      ((Object.values(CustomerSource) as string[]).includes(sourceKey)
        ? (sourceKey as CustomerSource)
        : CustomerSource.GUEST);

    return this.orders.adminCreateOrder(user, {
      type: data.type,
      customerId: data.customerId || null,
      customerName: data.customerName || null,
      email: data.email || null,
      phone: data.phone || null,
      source,
      serviceType: data.serviceType,
      size: data.size || null,
      name: data.name || null,
      designCount: data.designCount ?? null,
      priceCents: data.priceCents ?? null,
      instructions: data.instructions || null,
      channel: data.channel || data.source || null,
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const order = await this.orders.getAdminOrder(user, id);
    return { order };
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { status } = updateStatusSchema.parse(body);
    const order = await this.orders.updateStatus(user, id, status);
    return { order };
  }

  @Post(':id/resend-files')
  async resendFiles(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.orders.resendFiles(user, id);
  }

  @Patch(':id/approve')
  @RequireSupport('approve')
  async approve(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const order = await this.orders.approveOrder(user, id);
    return { order };
  }

  @Patch(':id/reject')
  async reject(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = rejectSchema.parse(body);
    const order = await this.orders.rejectOrder(user, id, data);
    return { order };
  }

  @Patch(':id/notes')
  async updateNotes(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { notes } = notesSchema.parse(body);
    const order = await this.orders.updateInternalNotes(user, id, notes);
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
    @Body() body: Record<string, string>,
  ) {
    let designIds: string[] | undefined;
    if (body?.designIds) {
      try {
        const parsed = JSON.parse(body.designIds);
        if (Array.isArray(parsed)) {
          designIds = parsed.map(String).filter(Boolean);
        }
      } catch {
        designIds = body.designIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return this.orders.deliverOrder(user, id, files, {
      deliveredVia:
        body?.deliveredVia === DeliveredVia.EMAIL
          ? DeliveredVia.EMAIL
          : DeliveredVia.PORTAL,
      designIds,
      notifyEmail: parseBool(body?.notifyEmail, true),
      notifySms: parseBool(body?.notifySms, true),
      complete: parseBool(body?.complete, true),
    });
  }

  @Post(':id/quotations')
  async proposeQuotation(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = proposeQuotationSchema.parse(body);
    const quotation = await this.orders.adminProposeQuotation(user, id, data);
    return { quotation };
  }

  @Patch(':id/quotations/counter/approve')
  @RequireSupport('approve')
  async approveCounter(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const order = await this.orders.adminAcceptCounter(user, id);
    return { order };
  }

  @Patch(':id/quotations/counter/reject')
  @RequireSupport('approve')
  async rejectCounter(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = counterDecisionSchema.parse(body);
    const order = await this.orders.adminRejectCounter(user, id, data);
    return { order };
  }

  @Post(':id/designs')
  async createDesign(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = createDesignSchema.parse(body);
    const design = await this.orders.createDesign(user, id, data);
    return { design };
  }

  @Patch(':id/designs/:designId')
  async updateDesign(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Param('designId') designId: string,
    @Body() body: unknown,
  ) {
    const data = updateDesignSchema.parse(body);
    const design = await this.orders.updateDesign(user, id, designId, data);
    return { design };
  }

  @Delete(':id/designs/:designId')
  async deleteDesign(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Param('designId') designId: string,
  ) {
    return this.orders.deleteDesign(user, id, designId);
  }

  @Post(':id/quote-builder')
  async quoteBuilder(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = quoteBuilderSchema.parse(body);
    const quotation = await this.orders.submitQuoteBuilder(user, id, data);
    return { quotation };
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async uploadAttachments(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const attachments = await this.orders.adminUploadOrderAttachments(
      user,
      id,
      files,
    );
    return { attachments };
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
