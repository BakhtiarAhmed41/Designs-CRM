import { Controller, Get, Param, Post } from '@nestjs/common';
import { BillingService } from './billing.service';

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

  @Post(':token')
  async pay(@Param('token') token: string) {
    return this.billing.payViaPayLink(token);
  }
}
