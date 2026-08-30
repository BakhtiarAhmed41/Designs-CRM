import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { BillingService } from './billing.service';

const checkoutSchema = z.object({
  returnOrigin: z.string().optional(),
});

/**
 * PUBLIC guest pay-link endpoints. Intentionally has NO guards so a customer
 * can view and settle an invoice without logging in; access is authorized
 * solely by possession of the opaque pay_link_token.
 */
@Controller('pay')
export class PayLinkController {
  constructor(private billing: BillingService) {}

  @Get(':token')
  async summary(@Param('token') token: string) {
    return this.billing.getPayLinkSummary(token);
  }

  @Post(':token/checkout')
  async checkout(@Param('token') token: string, @Body() body: unknown) {
    const data = checkoutSchema.parse(body ?? {});
    return this.billing.startCheckoutForPayLink(token, data.returnOrigin);
  }

  @Post(':token/confirm')
  async confirm(@Param('token') token: string) {
    return this.billing.confirmPayLink(token);
  }

  @Post(':token')
  async pay(@Param('token') token: string, @Body() body: unknown) {
    const data = checkoutSchema.parse(body ?? {});
    return this.billing.payViaPayLink(token, data.returnOrigin);
  }
}
