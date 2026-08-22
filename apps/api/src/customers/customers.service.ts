import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hashSecret } from '../auth/password';
import {
  AccountType,
  CustomerSource,
  LoginStatus,
  NetTerms,
  OrderStatus,
  UserRole,
} from '../common/enums';
import { DbService } from '../db/db.service';
import {
  normalizePage,
  pageResult,
  type PageParams,
} from '../common/pagination';

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

  async list(
    filters: { q?: string; accountType?: AccountType } & PageParams,
  ) {
    const { page, pageSize, offset } = normalizePage(filters);
    const where: string[] = ['c.merged_into_id IS NULL'];
    const params: unknown[] = [];
    if (filters.q) {
      where.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
      const like = `%${filters.q}%`;
      params.push(like, like, like);
    }
    if (filters.accountType) {
      where.push('c.account_type = ?');
      params.push(filters.accountType);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const count = await this.db.queryOne<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM customers c ${whereSql}`,
      params,
    );
    const rows = await this.db.query<
      CustomerStatsRow & { login_status: LoginStatus | null; running_orders: number | string }
    >(
      `SELECT c.*,
         u.login_status AS login_status,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id
            AND o.status NOT IN ('COMPLETED','CLOSED','CANCELLED','REJECTED','REFUNDED')) AS running_orders,
         (SELECT COALESCE(SUM(o.price_cents), 0) FROM orders o
            WHERE o.customer_id = c.id AND o.status IN (?, ?)) AS ltv_cents
       FROM customers c
       LEFT JOIN users u ON u.id = c.user_id
       ${whereSql}
       ORDER BY c.name ASC
       LIMIT ? OFFSET ?`,
      [...LTV_STATUSES, ...params, pageSize, offset],
    );
    return pageResult(
      rows.map((r) => ({
        ...this.statsDto(r),
        loginStatus: r.login_status,
        runningOrders: Number(r.running_orders ?? 0),
      })),
      Number(count?.n ?? 0),
      page,
      pageSize,
    );
  }

  private async getStatsRow(
    id: string,
  ): Promise<
    | (CustomerStatsRow & {
        login_status: LoginStatus | null;
        running_orders: number | string;
      })
    | null
  > {
    return this.db.queryOne(
      `SELECT c.*,
         u.login_status AS login_status,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id
            AND o.status NOT IN ('COMPLETED','CLOSED','CANCELLED','REJECTED','REFUNDED')) AS running_orders,
         (SELECT COALESCE(SUM(o.price_cents), 0) FROM orders o
            WHERE o.customer_id = c.id AND o.status IN (?, ?)) AS ltv_cents
       FROM customers c
       LEFT JOIN users u ON u.id = c.user_id
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
      loginStatus: row.login_status,
      runningOrders: Number(row.running_orders ?? 0),
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
    password?: string | null;
    accountType: AccountType;
    netTerms?: NetTerms | null;
    source: CustomerSource;
    active?: boolean;
  }) {
    const email = data.email?.trim().toLowerCase() || null;
    if (email) {
      const dupCustomer = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM customers WHERE email = ? AND merged_into_id IS NULL LIMIT 1',
        [email],
      );
      if (dupCustomer) throw new ConflictException('A customer with this email already exists');
      const dupUser = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      if (dupUser) throw new ConflictException('A user with this email already exists');
    }
    if (data.password && data.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    if (data.password && !email) {
      throw new BadRequestException('Email is required when setting a password');
    }

    const id = this.db.uuid();
    let userId: string | null = null;

    await this.db.withTransaction(async (tx) => {
      if (data.password && email) {
        userId = this.db.uuid();
        const passwordHash = await hashSecret(data.password);
        const initials = data.name.slice(0, 2).toUpperCase();
        const nameParts = data.name.trim().split(/\s+/);
        await tx.execute(
          `INSERT INTO users
             (id, email, password_hash, role, login_status, first_name, last_name, phone, initials, presence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFF')`,
          [
            userId,
            email,
            passwordHash,
            UserRole.CLIENT,
            data.active === false ? LoginStatus.DISABLED : LoginStatus.ACTIVE,
            nameParts[0] || null,
            nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
            data.phone || null,
            initials,
          ],
        );
      }
      await tx.execute(
        `INSERT INTO customers
           (id, user_id, name, email, phone, account_type, net_terms, source, since_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
        [
          id,
          userId,
          data.name,
          email,
          data.phone || null,
          data.accountType,
          data.netTerms ?? null,
          data.source,
        ],
      );
    });
    return this.detail(id);
  }

  async remove(id: string) {
    const existing = await this.db.queryOne<{ id: string; user_id: string | null }>(
      'SELECT id, user_id FROM customers WHERE id = ? LIMIT 1',
      [id],
    );
    if (!existing) throw new NotFoundException('Customer not found');
    const orderCount = await this.db.queryOne<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?',
      [id],
    );
    if (Number(orderCount?.n ?? 0) > 0) {
      throw new BadRequestException(
        'Cannot delete a customer with orders. Disable their login instead.',
      );
    }
    await this.db.withTransaction(async (tx) => {
      await tx.execute('DELETE FROM customers WHERE id = ?', [id]);
      if (existing.user_id) {
        await tx.execute('DELETE FROM users WHERE id = ? AND role = ?', [
          existing.user_id,
          UserRole.CLIENT,
        ]);
      }
    });
    return { ok: true };
  }

  async setLoginStatus(customerId: string, active: boolean) {
    const customer = await this.db.queryOne<{ user_id: string | null }>(
      'SELECT user_id FROM customers WHERE id = ? LIMIT 1',
      [customerId],
    );
    if (!customer) throw new NotFoundException('Customer not found');
    if (!customer.user_id) {
      throw new BadRequestException('Customer has no login account');
    }
    await this.db.execute('UPDATE users SET login_status = ? WHERE id = ?', [
      active ? LoginStatus.ACTIVE : LoginStatus.DISABLED,
      customer.user_id,
    ]);
    return this.detail(customerId);
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
      active?: boolean;
      password?: string | null;
    },
  ) {
    const existing = await this.db.queryOne<{
      id: string;
      user_id: string | null;
      email: string | null;
    }>('SELECT id, user_id, email FROM customers WHERE id = ? LIMIT 1', [id]);
    if (!existing) throw new NotFoundException('Customer not found');

    if (data.email !== undefined && data.email) {
      const email = data.email.toLowerCase();
      const dup = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM customers WHERE email = ? AND id <> ? AND merged_into_id IS NULL LIMIT 1',
        [email, id],
      );
      if (dup) throw new ConflictException('A customer with this email already exists');
    }

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

    if (existing.user_id) {
      const userSets: string[] = [];
      const userParams: unknown[] = [];
      if (data.active !== undefined) {
        userSets.push('login_status = ?');
        userParams.push(data.active ? LoginStatus.ACTIVE : LoginStatus.DISABLED);
      }
      if (data.password) {
        if (data.password.length < 6) {
          throw new BadRequestException('Password must be at least 6 characters');
        }
        userSets.push('password_hash = ?');
        userParams.push(await hashSecret(data.password));
      }
      if (data.phone !== undefined) {
        userSets.push('phone = ?');
        userParams.push(data.phone || null);
      }
      if (data.email !== undefined && data.email) {
        userSets.push('email = ?');
        userParams.push(data.email.toLowerCase());
      }
      if (userSets.length) {
        userParams.push(existing.user_id);
        await this.db.execute(
          `UPDATE users SET ${userSets.join(', ')} WHERE id = ?`,
          userParams,
        );
      }
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
