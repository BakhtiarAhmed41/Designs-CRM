import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';

const paySchema = z.object({
  method: z.enum(['CARD', 'STORE_CREDIT']),
});

const checkoutSchema = z.object({
  returnOrigin: z.string().optional(),
  returnPath: z.string().optional(),
});

@Controller()
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private billing: BillingService) {}

  @Get('invoices')
  async listMine(@CurrentUser() user: AuthUser | undefined) {
    return this.billing.listMyInvoices(user);
  }

  @Get('invoices/summary')
  async summaryMine(@CurrentUser() user: AuthUser | undefined) {
    return this.billing.myInvoiceSummary(user);
  }

  @Post('invoices/by-order/:orderId/checkout')
  async checkoutMyOrder(
    @CurrentUser() user: AuthUser | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ) {
    const data = checkoutSchema.parse(body ?? {});
    return this.billing.startCheckoutForMyOrder(user, orderId, data);
  }

  @Get('invoices/:id/print')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async printMine(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const html = await this.billing.getInvoicePrintHtml(user, id);
    res.send(html);
  }

  @Post('invoices/:id/pay')
  async payMine(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { method } = paySchema.parse(body);
    return this.billing.payMyInvoice(user, id, method);
  }

  @Post('invoices/:id/checkout')
  async checkoutMine(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = checkoutSchema.parse(body ?? {});
    return this.billing.startCheckoutForMyInvoice(user, id, data);
  }

  @Post('invoices/:id/confirm')
  async confirmMine(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    return this.billing.confirmMyInvoice(user, id);
  }

  @Get('store-credit')
  async myStoreCredit(@CurrentUser() user: AuthUser | undefined) {
    return this.billing.getMyStoreCredit(user);
  }
}
