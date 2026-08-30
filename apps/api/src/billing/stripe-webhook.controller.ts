import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';

@Controller('stripe')
export class StripeWebhookController {
  constructor(private billing: BillingService) {}

  @Post('webhook')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!signature) throw new BadRequestException('Missing Stripe signature');
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('Missing raw request body');
    try {
      await this.billing.handleStripeWebhook(raw, signature);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid webhook';
      throw new BadRequestException(message);
    }
    return { received: true };
  }
}
