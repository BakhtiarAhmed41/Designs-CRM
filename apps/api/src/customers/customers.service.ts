import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  CustomerSource,
  NetTerms,
  OrderStatus,
} from '../common/enums';
import { DbService } from '../db/db.service';

type CustomerRow = {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  account_type: AccountType;
  net_terms: NetTerms | null;
  source: CustomerSource;
  store_credit_cents: number;
  since_date: Date | null;
  merged_into_id: string | null;
  preferences: unknown;
  created_at: Date;
  updated_at: Date;
};

type CustomerStatsRow = CustomerRow & {
  orders_count: number | string;
  ltv_cents: number | string;
};

const LTV_STATUSES = [OrderStatus.COMPLETED, OrderStatus.CLOSED];

@Injectable()
export class CustomersService {
  constructor(private db: DbService) {}

  private customerDto(c: CustomerRow) {
    return {
      id: c.id,
      userId: c.user_id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      accountType: c.account_type,
      netTerms: c.net_terms,
      source: c.source,
      storeCreditCents: Number(c.store_credit_cents ?? 0),
      sinceDate: c.since_date,
      mergedIntoId: c.merged_into_id,
      preferences: c.preferences ?? null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }

  private statsDto(c: CustomerStatsRow) {
    return {
      ...this.customerDto(c),
      ordersCount: Number(c.orders_count ?? 0),
      ltvCents: Number(c.ltv_cents ?? 0),
    };
  }

  async list(filters: { q?: string; accountType?: AccountType }) {
    const where: string[] = ['c.merged_into_id IS NULL'];
    const params: unknown[] = [];
    if (filters.q) {
      where.push('(c.name LIKE ? OR c.email LIKE ?)');
      const like = `%${filters.q}%`;
      params.push(like, like);
    }
    if (filters.accountType) {
      where.push('c.account_type = ?');
      params.push(filters.accountType);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const rows = await this.db.query<CustomerStatsRow>(
      `SELECT c.*,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count,
         (SELECT COALESCE(SUM(o.price_cents), 0) FROM orders o
            WHERE o.customer_id = c.id AND o.status IN (?, ?)) AS ltv_cents
       FROM customers c
       ${whereSql}
       ORDER BY c.name ASC`,
      [...LTV_STATUSES, ...params],
    );
    return rows.map((r) => this.statsDto(r));
  }

  private async getStatsRow(id: string): Promise<CustomerStatsRow | null> {
    return this.db.queryOne<CustomerStatsRow>(
      `SELECT c.*,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count,
         (SELECT COALESCE(SUM(o.price_cents), 0) FROM orders o
            WHERE o.customer_id = c.id AND o.status IN (?, ?)) AS ltv_cents
       FROM customers c
       WHERE c.id = ? LIMIT 1`,
      [...LTV_STATUSES, id],
    );
  }

  async detail(id: string) {
    const row = await this.getStatsRow(id);
    if (!row) throw new NotFoundException('Customer not found');

    const recentOrders = await this.db.query<{
      id: string;
      human_ref: string | null;
      name: string | null;
      status: OrderStatus;
      price_cents: number | null;
      currency: string;
      created_at: Date;
    }>(
      `SELECT id, human_ref, name, status, price_cents, currency, created_at
         FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10`,
      [id],
    );

    const openInvoices = await this.db.queryOne<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE customer_id = ? AND status = 'AWAITING'`,
      [id],
    );

    return {
      ...this.statsDto(row),
      openInvoicesCount: Number(openInvoices?.cnt ?? 0),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        humanRef: o.human_ref,
        name: o.name,
        status: o.status,
        priceCents: o.price_cents,
        currency: o.currency,
        createdAt: o.created_at,
      })),
    };
  }

  async create(data: {
    name: string;
    email?: string | null;
    phone?: string | null;
    accountType: AccountType;
    netTerms?: NetTerms | null;
    source: CustomerSource;
  }) {
    const id = this.db.uuid();
    await this.db.execute(
      `INSERT INTO customers
         (id, name, email, phone, account_type, net_terms, source, since_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`,
      [
        id,
        data.name,
        data.email?.toLowerCase() || null,
        data.phone || null,
        data.accountType,
        data.netTerms ?? null,
        data.source,
      ],
    );
    return this.detail(id);
  }

  async update(
    id: string,
    data: {
      name?: string;
      email?: string | null;
      phone?: string | null;
      accountType?: AccountType;
      netTerms?: NetTerms | null;
      source?: CustomerSource;
    },
  ) {
    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM customers WHERE id = ? LIMIT 1',
      [id],
    );
    if (!existing) throw new NotFoundException('Customer not found');

    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.name !== undefined) {
      sets.push('name = ?');
      params.push(data.name);
    }
    if (data.email !== undefined) {
      sets.push('email = ?');
      params.push(data.email?.toLowerCase() || null);
    }
    if (data.phone !== undefined) {
      sets.push('phone = ?');
      params.push(data.phone || null);
    }
    if (data.accountType !== undefined) {
      sets.push('account_type = ?');
      params.push(data.accountType);
    }
    if (data.netTerms !== undefined) {
      sets.push('net_terms = ?');
      params.push(data.netTerms);
    }
    if (data.source !== undefined) {
      sets.push('source = ?');
      params.push(data.source);
    }
    if (sets.length > 0) {
      params.push(id);
      await this.db.execute(
        `UPDATE customers SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    return this.detail(id);
  }

  async merge(sourceId: string, intoId: string) {
    if (sourceId === intoId)
      throw new BadRequestException('Cannot merge a customer into itself');

    return this.db.withTransaction(async (tx) => {
      const source = await tx.queryOne<CustomerRow>(
        'SELECT * FROM customers WHERE id = ? LIMIT 1',
        [sourceId],
      );
      if (!source) throw new NotFoundException('Source customer not found');
      if (source.merged_into_id)
        throw new BadRequestException('Source customer is already merged');

      const target = await tx.queryOne<CustomerRow>(
        'SELECT * FROM customers WHERE id = ? LIMIT 1',
        [intoId],
      );
      if (!target) throw new NotFoundException('Target customer not found');
      if (target.merged_into_id)
        throw new BadRequestException('Target customer is already merged');

      await tx.execute('UPDATE orders SET customer_id = ? WHERE customer_id = ?', [
        intoId,
        sourceId,
      ]);
      await tx.execute(
        'UPDATE invoices SET customer_id = ? WHERE customer_id = ?',
        [intoId, sourceId],
      );
      await tx.execute(
        'UPDATE conversations SET customer_id = ? WHERE customer_id = ?',
        [intoId, sourceId],
      );

      const credit = Number(source.store_credit_cents ?? 0);
      if (credit !== 0) {
        await tx.execute(
          'UPDATE customers SET store_credit_cents = store_credit_cents + ? WHERE id = ?',
          [credit, intoId],
        );
      }

      await tx.execute(
        'UPDATE customers SET merged_into_id = ?, store_credit_cents = 0 WHERE id = ?',
        [intoId, sourceId],
      );

      return { sourceId, intoId };
    });
  }

  async getForUser(userId: string) {
    const row = await this.db.queryOne<CustomerRow>(
      'SELECT * FROM customers WHERE user_id = ? AND merged_into_id IS NULL LIMIT 1',
      [userId],
    );
    return row ? this.customerDto(row) : null;
  }

  async updateForUser(
    userId: string,
    data: {
      name?: string;
      phone?: string | null;
      preferences?: unknown;
    },
  ) {
    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM customers WHERE user_id = ? AND merged_into_id IS NULL LIMIT 1',
      [userId],
    );
    if (!existing) throw new NotFoundException('Customer profile not found');

    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.name !== undefined) {
      sets.push('name = ?');
      params.push(data.name);
    }
    if (data.phone !== undefined) {
      sets.push('phone = ?');
      params.push(data.phone || null);
    }
    if (data.preferences !== undefined) {
      sets.push('preferences = ?');
      params.push(JSON.stringify(data.preferences));
    }
    if (sets.length > 0) {
      params.push(existing.id);
      await this.db.execute(
        `UPDATE customers SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    return this.getForUser(userId);
  }
}
