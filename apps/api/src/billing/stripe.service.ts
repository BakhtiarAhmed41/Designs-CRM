import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import Stripe from 'stripe';
import { getEnv } from '../config/env';

function integrationLabel(kind: string) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(8);
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += letters[bytes[i] % 26];
  return `lvd-${kind}-${suffix}`;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null = null;

  isConfigured() {
    return Boolean(getEnv().STRIPE_SECRET_KEY.trim());
  }

  getClient(): Stripe {
    const key = getEnv().STRIPE_SECRET_KEY.trim();
    if (!key) {
      throw new BadRequestException(
        'Card checkout is not configured. Add STRIPE_SECRET_KEY to the API env.',
      );
    }
    if (!this.client) this.client = new Stripe(key);
    return this.client;
  }

  async createInvoiceCheckout(input: {
    amountCents: number;
    currency: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    invoiceId: string;
    paymentId: string;
    customerEmail?: string | null;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = this.getClient();
    const currency = (input.currency || 'USD').toLowerCase();
    let session;
    try {
      session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail?.trim() || undefined,
      client_reference_id: input.invoiceId,
      metadata: {
        invoiceId: input.invoiceId,
        paymentId: input.paymentId,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: input.amountCents,
            product_data: {
              name: input.productName.slice(0, 120) || 'Invoice',
            },
          },
        },
      ],
      integration_identifier: integrationLabel('invpay'),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Stripe checkout failed';
      this.logger.warn(message);
      throw new BadRequestException(
        'Could not start card checkout. Check the Stripe keys and try again.',
      );
    }
    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }
    return session;
  }

  async retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.getClient().checkout.sessions.retrieve(sessionId);
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = getEnv().STRIPE_WEBHOOK_SECRET.trim();
    if (!secret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not set');
    }
    return this.getClient().webhooks.constructEvent(rawBody, signature, secret);
  }

  async refundPaymentIntent(
    paymentIntentId: string,
    amountCents: number,
  ): Promise<Stripe.Refund> {
    try {
      return await this.getClient().refunds.create({
        payment_intent: paymentIntentId,
        amount: amountCents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe refund failed';
      this.logger.warn(message);
      throw new BadRequestException(
        'Stripe could not refund this card payment. Try again or refund to store credit.',
      );
    }
  }

}
