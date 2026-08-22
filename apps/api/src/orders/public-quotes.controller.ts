import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { OrdersService } from './orders.service';

const intentSchema = z.object({
  serviceKey: z.string().min(1).max(40),
  payload: z.any(),
});

@Controller('public')
export class PublicQuotesController {
  constructor(private orders: OrdersService) {}

  @Get('turnaround')
  async turnaround() {
    return this.orders.listTurnaroundOptions();
  }

  @Post('quote-intents')
  async createIntent(@Body() body: unknown) {
    const data = intentSchema.parse(body);
    return this.orders.createQuoteIntent(data.serviceKey, data.payload);
  }
}
