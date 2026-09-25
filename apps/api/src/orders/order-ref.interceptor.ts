import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { OrdersService } from './orders.service';

const PUBLIC_REF = /^\d{6,12}$/;

/**
 * Quote and order pages use the short public number in the URL.
 * APIs still key rows by UUID, so numeric ids are resolved first.
 */
@Injectable()
export class OrderRefInterceptor implements NestInterceptor {
  constructor(private readonly orders: OrdersService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();
    const path = `${req.path ?? ''} ${req.url ?? ''}`;
    const touchesOrder = path.includes('/orders') || path.includes('by-order');
    await this.rewrite(req.params, touchesOrder ? ['id', 'orderId'] : ['orderId']);
    await this.rewrite(req.query, ['orderId']);
    await this.rewrite(req.body, ['orderId']);
    return next.handle();
  }

  private async rewrite(bag: Record<string, unknown> | undefined, keys: string[]) {
    if (!bag) return;
    for (const key of keys) {
      const value = bag[key];
      if (typeof value !== 'string' || !PUBLIC_REF.test(value)) continue;
      const id = await this.orders.resolveOrderId(value);
      if (id) bag[key] = id;
    }
  }
}
