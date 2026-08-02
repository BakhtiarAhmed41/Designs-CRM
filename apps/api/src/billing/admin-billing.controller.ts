import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums';
import { BillingService } from './billing.service';

const createInvoiceSchema = z.object({
  customerId: z.string().min(1),
  orderId: z.string().min(1).optional().nullable(),
  amountCents: z.number().int().positive(),
  coversText: z.string().optional().nullable(),
});

const paySchema = z.object({
  method: z.enum(['CARD', 'STORE_CREDIT']),
});

const storeCreditSchema = z.object({
  deltaCents: z.number().int(),
  reason: z.string().optional().nullable(),
});

const refundSchema = z.object({
  amountCents: z.number().int().positive(),
  to: z.enum(['CARD', 'STORE_CREDIT']),
  reason: z.string().optional().nullable(),
});

const monthEndSchema = z.object({
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
export class AdminBillingController {
  constructor(private billing: BillingService) {}

  @Get('invoices')
  async listInvoices(
    @CurrentUser() user: AuthUser | undefined,
    @Query('status') status: string | undefined,
    @Query('customerId') customerId: string | undefined,
    @Query('q') q: string | undefined,
  ) {
    const invoices = await this.billing.listInvoices(user, {
      status: status || undefined,
      customerId: customerId || undefined,
      q: q?.trim() || undefined,
    });
    return { invoices };
  }

  @Post('invoices')
  async createInvoice(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = createInvoiceSchema.parse(body);
    const invoice = await this.billing.createInvoice(user, data);
    return { invoice };
  }

  @Get('invoices/:id')
  async getInvoice(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const invoice = await this.billing.getInvoiceDetail(user, id);
    return { invoice };
  }

  @Get('invoices/:id/print')
  async printInvoice(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const html = await this.billing.getInvoicePrintHtml(user, id);
    res.type('text/html').send(html);
  }

  @Post('invoices/:id/pay')
  async payInvoice(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { method } = paySchema.parse(body);
    const invoice = await this.billing.payInvoiceAsAdmin(user, id, method);
    return { invoice };
  }

  @Post('invoices/:id/pay-link')
  async createPayLink(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.billing.createPayLink(user, id);
  }

  @Post('invoices/:id/cancel')
  async cancelInvoice(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const invoice = await this.billing.cancelInvoice(user, id);
    return { invoice };
  }

  @Post('invoices/:id/remind')
  async remindInvoice(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.billing.remindInvoice(user, id);
  }

  @Post('invoices/:id/refund')
  async refundInvoice(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = refundSchema.parse(body);
    const invoice = await this.billing.refundInvoice(user, id, data);
    return { invoice };
  }

  @Post('orders/:id/refund')
  async refundOrder(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = refundSchema.parse(body);
    return this.billing.refundOrder(user, id, data);
  }

  @Get('customers/:id/store-credit')
  async getStoreCredit(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.billing.getStoreCredit(user, id);
  }

  @Post('customers/:id/store-credit')
  async adjustStoreCredit(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = storeCreditSchema.parse(body);
    return this.billing.adjustStoreCredit(user, id, data);
  }

  @Post('billing/month-end')
  async monthEnd(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: unknown,
  ) {
    const data = monthEndSchema.parse(body ?? {});
    return this.billing.runMonthEnd(user, data);
  }

  @Get('billing/summary')
  async summary(@CurrentUser() user: AuthUser | undefined) {
    return this.billing.billingSummary(user);
  }
}
