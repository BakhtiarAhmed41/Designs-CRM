import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import {
  AccountType,
  InvoiceKind,
  InvoiceStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  RefundTo,
  UserRole,
} from '../common/enums';
import { DbService, DbTransaction } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

function isAdminRole(role: UserRole): boolean {
  return (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.ADMIN ||
    role === UserRole.SUPPORT ||
    role === UserRole.DESIGNER
  );
}

/** 'YYYY-MM' for the current month. */
function currentPeriodMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function isValidPeriodMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthLabel(period: string): string {
  const [y, m] = period.split('-').map((n) => Number(n));
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

type InvoiceRow = {
  id: string;
  customer_id: string;
  order_id: string | null;
  kind: InvoiceKind;
  amount_cents: number;
  currency: string;
  covers_text: string | null;
  status: InvoiceStatus;
  period_month: string | null;
  store_credit_applied_cents: number;
  issued_at: Date;
  paid_at: Date | null;
};

type PaymentRow = {
  id: string;
  invoice_id: string | null;
  order_id: string | null;
  customer_id: string | null;
  amount_cents: number;
  currency: string;
  method: PaymentMethod;
  type: PaymentType;
  refund_to: RefundTo | null;
  pay_link_token: string | null;
  status: PaymentStatus;
  reason: string | null;
  created_at: Date;
  paid_at: Date | null;
};

type StoreCreditRow = {
  id: string;
  customer_id: string;
  delta_cents: number;
  reason: string | null;
  created_at: Date;
};

type CustomerRow = {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  account_type: AccountType;
  currency?: string | null;
  store_credit_cents: number;
};

@Injectable()
export class BillingService {
  constructor(
    private db: DbService,
    private notifications: NotificationsService,
  ) {}

  // --- mappers -------------------------------------------------------------

  private invoiceDto(i: InvoiceRow & { customer_name?: string | null }) {
    return {
      id: i.id,
      customerId: i.customer_id,
      customerName: i.customer_name ?? null,
      orderId: i.order_id,
      kind: i.kind,
      amountCents: i.amount_cents,
      currency: i.currency,
      coversText: i.covers_text,
      status: i.status,
      periodMonth: i.period_month,
      storeCreditAppliedCents: i.store_credit_applied_cents,
      issuedAt: i.issued_at,
      paidAt: i.paid_at,
    };
  }

  private paymentDto(p: PaymentRow) {
    return {
      id: p.id,
      invoiceId: p.invoice_id,
      orderId: p.order_id,
      customerId: p.customer_id,
      amountCents: p.amount_cents,
      currency: p.currency,
      method: p.method,
      type: p.type,
      refundTo: p.refund_to,
      status: p.status,
      reason: p.reason,
      createdAt: p.created_at,
      paidAt: p.paid_at,
    };
  }

  private creditEntryDto(e: StoreCreditRow) {
    return {
      id: e.id,
      customerId: e.customer_id,
      deltaCents: e.delta_cents,
      reason: e.reason,
      createdAt: e.created_at,
    };
  }

  // --- guards / lookups ----------------------------------------------------

  private assertAdmin(user: AuthUser | undefined): asserts user is AuthUser {
    assertAuthUser(user);
    if (!isAdminRole(user.role)) throw new ForbiddenException();
  }

  private async getInvoiceRow(id: string): Promise<InvoiceRow | null> {
    return this.db.queryOne<InvoiceRow>(
      'SELECT * FROM invoices WHERE id = ? LIMIT 1',
      [id],
    );
  }

  private async getCustomerRow(id: string): Promise<CustomerRow | null> {
    return this.db.queryOne<CustomerRow>(
      'SELECT id, user_id, name, email, account_type, store_credit_cents FROM customers WHERE id = ? LIMIT 1',
      [id],
    );
  }

  private async resolveMyCustomer(
    user: AuthUser | undefined,
  ): Promise<CustomerRow> {
    assertAuthUser(user);
    const row = await this.db.queryOne<CustomerRow>(
      'SELECT id, user_id, name, email, account_type, store_credit_cents FROM customers WHERE user_id = ? LIMIT 1',
      [user.id],
    );
    if (!row)
      throw new NotFoundException('No customer profile linked to this account');
    return row;
  }

  private async notifyCustomerUser(
    customerId: string,
    input: { title: string; body?: string | null; link?: string | null },
  ) {
    const customer = await this.db.queryOne<{ user_id: string | null }>(
      'SELECT user_id FROM customers WHERE id = ? LIMIT 1',
      [customerId],
    );
    if (customer?.user_id) {
      await this.notifications.createFor(customer.user_id, input);
    }
  }

  // --- invoices (admin) ----------------------------------------------------

  async listInvoices(
    user: AuthUser | undefined,
    filters: { status?: string; customerId?: string },
  ) {
    this.assertAdmin(user);
    const where: string[] = [];
    const params: unknown[] = [];
    const statuses = Object.values(InvoiceStatus) as string[];
    if (filters.status && statuses.includes(filters.status)) {
      where.push('i.status = ?');
      params.push(filters.status);
    }
    if (filters.customerId) {
      where.push('i.customer_id = ?');
      params.push(filters.customerId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<InvoiceRow & { customer_name: string | null }>(
      `SELECT i.*, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         ${whereSql}
         ORDER BY i.issued_at DESC`,
      params,
    );
    return rows.map((r) => this.invoiceDto(r));
  }

  async createInvoice(
    user: AuthUser | undefined,
    data: {
      customerId: string;
      orderId?: string | null;
      amountCents: number;
      coversText?: string | null;
    },
  ) {
    this.assertAdmin(user);
    const customer = await this.getCustomerRow(data.customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (!Number.isInteger(data.amountCents) || data.amountCents <= 0)
      throw new BadRequestException('amountCents must be a positive integer');

    let currency = 'USD';
    if (data.orderId) {
      const order = await this.db.queryOne<{ currency: string | null }>(
        'SELECT currency FROM orders WHERE id = ? LIMIT 1',
        [data.orderId],
      );
      if (!order) throw new NotFoundException('Order not found');
      currency = order.currency || 'USD';
    }

    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO invoices
         (id, customer_id, order_id, kind, amount_cents, currency, covers_text, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.customerId,
        data.orderId ?? null,
        InvoiceKind.PER_ORDER,
        data.amountCents,
        currency,
        data.coversText?.trim() || null,
        InvoiceStatus.AWAITING,
      ],
    );

    await this.notifyCustomerUser(data.customerId, {
      title: 'New invoice',
      body: `An invoice for your account is awaiting payment.`,
      link: '/portal/invoices',
    });

    return this.getInvoiceDetail(user, id);
  }

  async getInvoiceDetail(user: AuthUser | undefined, id: string) {
    this.assertAdmin(user);
    const invoice = await this.db.queryOne<
      InvoiceRow & { customer_name: string | null }
    >(
      `SELECT i.*, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.id = ? LIMIT 1`,
      [id],
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    const payments = await this.db.query<PaymentRow>(
      'SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at ASC',
      [id],
    );
    const customer = await this.getCustomerRow(invoice.customer_id);
    return {
      ...this.invoiceDto(invoice),
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            accountType: customer.account_type,
            storeCreditCents: customer.store_credit_cents,
          }
        : null,
      payments: payments.map((p) => this.paymentDto(p)),
    };
  }

  async cancelInvoice(user: AuthUser | undefined, invoiceId: string) {
    this.assertAdmin(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== InvoiceStatus.AWAITING) {
      throw new BadRequestException('Only awaiting invoices can be cancelled');
    }

    await this.db.withTransaction(async (tx) => {
      await tx.execute('UPDATE invoices SET status = ? WHERE id = ?', [
        InvoiceStatus.CANCELLED,
        invoiceId,
      ]);
      await tx.execute(
        `UPDATE payments SET status = ?
          WHERE invoice_id = ? AND status = ? AND pay_link_token IS NOT NULL`,
        [PaymentStatus.FAILED, invoiceId, PaymentStatus.PENDING],
      );
    });

    return this.getInvoiceDetail(user, invoiceId);
  }

  async remindInvoice(user: AuthUser | undefined, invoiceId: string) {
    this.assertAdmin(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== InvoiceStatus.AWAITING) {
      throw new BadRequestException('Only awaiting invoices can be reminded');
    }

    const payLink = await this.createPayLink(user, invoiceId);
    await this.notifyCustomerUser(invoice.customer_id, {
      title: 'Payment reminder',
      body: `Your invoice for ${invoice.covers_text ?? 'your order'} is still awaiting payment.`,
      link: payLink.url,
    });

    return { ...payLink, invoiceId };
  }

  // --- pay an invoice (shared by admin + customer) -------------------------

  private async payInvoiceInternal(
    invoice: InvoiceRow,
    method: 'CARD' | 'STORE_CREDIT',
  ) {
    if (invoice.status === InvoiceStatus.PAID) {
      // Idempotent: already settled.
      return;
    }

    if (method === PaymentMethod.STORE_CREDIT) {
      await this.db.withTransaction(async (tx) => {
        const customer = await tx.queryOne<{ store_credit_cents: number }>(
          'SELECT store_credit_cents FROM customers WHERE id = ? LIMIT 1 FOR UPDATE',
          [invoice.customer_id],
        );
        if (!customer) throw new NotFoundException('Customer not found');
        if (customer.store_credit_cents < invoice.amount_cents)
          throw new BadRequestException('Insufficient store credit');

        await tx.execute(
          'UPDATE customers SET store_credit_cents = store_credit_cents - ? WHERE id = ?',
          [invoice.amount_cents, invoice.customer_id],
        );
        await tx.execute(
          'INSERT INTO store_credit_entries (id, customer_id, delta_cents, reason) VALUES (?, ?, ?, ?)',
          [
            randomUUID(),
            invoice.customer_id,
            -invoice.amount_cents,
            `Applied to invoice ${invoice.id}`,
          ],
        );
        await tx.execute(
          `INSERT INTO payments
             (id, invoice_id, order_id, customer_id, amount_cents, currency, method, type, status, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            randomUUID(),
            invoice.id,
            invoice.order_id,
            invoice.customer_id,
            invoice.amount_cents,
            invoice.currency,
            PaymentMethod.STORE_CREDIT,
            PaymentType.CHARGE,
            PaymentStatus.PAID,
          ],
        );
        await tx.execute(
          'UPDATE invoices SET status = ?, paid_at = NOW(), store_credit_applied_cents = store_credit_applied_cents + ? WHERE id = ?',
          [InvoiceStatus.PAID, invoice.amount_cents, invoice.id],
        );
      });
    } else {
      // CARD: simulated successful charge.
      await this.db.execute(
        `INSERT INTO payments
           (id, invoice_id, order_id, customer_id, amount_cents, currency, method, type, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          randomUUID(),
          invoice.id,
          invoice.order_id,
          invoice.customer_id,
          invoice.amount_cents,
          invoice.currency,
          PaymentMethod.CARD,
          PaymentType.CHARGE,
          PaymentStatus.PAID,
        ],
      );
      await this.db.execute(
        'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
        [InvoiceStatus.PAID, invoice.id],
      );
    }
  }

  async payInvoiceAsAdmin(
    user: AuthUser | undefined,
    invoiceId: string,
    method: string,
  ) {
    this.assertAdmin(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const m = this.parsePayMethod(method);
    await this.payInvoiceInternal(invoice, m);
    return this.getInvoiceDetail(user, invoiceId);
  }

  private parsePayMethod(method: string): 'CARD' | 'STORE_CREDIT' {
    if (method === PaymentMethod.CARD) return PaymentMethod.CARD;
    if (method === PaymentMethod.STORE_CREDIT) return PaymentMethod.STORE_CREDIT;
    throw new BadRequestException('method must be CARD or STORE_CREDIT');
  }

  // --- guest pay-links -----------------------------------------------------

  async createPayLink(user: AuthUser | undefined, invoiceId: string) {
    this.assertAdmin(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID)
      throw new BadRequestException('Invoice is already paid');

    const token = randomBytes(24).toString('hex');
    await this.db.execute(
      `INSERT INTO payments
         (id, invoice_id, order_id, customer_id, amount_cents, currency, method, type, pay_link_token, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        invoice.id,
        invoice.order_id,
        invoice.customer_id,
        invoice.amount_cents,
        invoice.currency,
        PaymentMethod.LINK,
        PaymentType.CHARGE,
        token,
        PaymentStatus.PENDING,
      ],
    );
    return { token, url: `/pay/${token}` };
  }

  /** PUBLIC: safe summary for a pay-link. */
  async getPayLinkSummary(token: string) {
    const payment = await this.db.queryOne<PaymentRow>(
      'SELECT * FROM payments WHERE pay_link_token = ? LIMIT 1',
      [token],
    );
    if (!payment || !payment.invoice_id)
      throw new NotFoundException('Payment link not found');
    const invoice = await this.db.queryOne<
      InvoiceRow & { customer_name: string | null }
    >(
      `SELECT i.*, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.id = ? LIMIT 1`,
      [payment.invoice_id],
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    return {
      amountCents: invoice.amount_cents,
      currency: invoice.currency,
      customerName: invoice.customer_name ?? null,
      coversText: invoice.covers_text,
      status: invoice.status,
    };
  }

  /** PUBLIC: simulate a successful card payment via a pay-link. Idempotent. */
  async payViaPayLink(token: string) {
    const payment = await this.db.queryOne<PaymentRow>(
      'SELECT * FROM payments WHERE pay_link_token = ? LIMIT 1',
      [token],
    );
    if (!payment || !payment.invoice_id)
      throw new NotFoundException('Payment link not found');

    if (payment.status === PaymentStatus.PAID) {
      return { status: InvoiceStatus.PAID };
    }

    await this.db.withTransaction(async (tx) => {
      await tx.execute(
        'UPDATE payments SET status = ?, paid_at = NOW() WHERE id = ?',
        [PaymentStatus.PAID, payment.id],
      );
      await tx.execute(
        'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ? AND status <> ?',
        [InvoiceStatus.PAID, payment.invoice_id, InvoiceStatus.PAID],
      );
    });

    if (payment.customer_id) {
      await this.notifyCustomerUser(payment.customer_id, {
        title: 'Payment received',
        body: 'Thank you — your invoice has been marked as paid.',
        link: '/portal/invoices',
      });
    }
    return { status: InvoiceStatus.PAID };
  }

  // --- store credit (admin) ------------------------------------------------

  async getStoreCredit(user: AuthUser | undefined, customerId: string) {
    this.assertAdmin(user);
    const customer = await this.getCustomerRow(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    const entries = await this.db.query<StoreCreditRow>(
      'SELECT * FROM store_credit_entries WHERE customer_id = ? ORDER BY created_at DESC',
      [customerId],
    );
    return {
      balanceCents: customer.store_credit_cents,
      entries: entries.map((e) => this.creditEntryDto(e)),
    };
  }

  async adjustStoreCredit(
    user: AuthUser | undefined,
    customerId: string,
    data: { deltaCents: number; reason?: string | null },
  ) {
    this.assertAdmin(user);
    if (!Number.isInteger(data.deltaCents) || data.deltaCents === 0)
      throw new BadRequestException('deltaCents must be a non-zero integer');

    await this.db.withTransaction(async (tx) => {
      const customer = await tx.queryOne<{ store_credit_cents: number }>(
        'SELECT store_credit_cents FROM customers WHERE id = ? LIMIT 1 FOR UPDATE',
        [customerId],
      );
      if (!customer) throw new NotFoundException('Customer not found');
      const next = customer.store_credit_cents + data.deltaCents;
      if (next < 0)
        throw new BadRequestException(
          'Adjustment would make store credit negative',
        );
      await tx.execute(
        'INSERT INTO store_credit_entries (id, customer_id, delta_cents, reason) VALUES (?, ?, ?, ?)',
        [randomUUID(), customerId, data.deltaCents, data.reason?.trim() || null],
      );
      await tx.execute(
        'UPDATE customers SET store_credit_cents = store_credit_cents + ? WHERE id = ?',
        [data.deltaCents, customerId],
      );
    });

    return this.getStoreCredit(user, customerId);
  }

  // --- refunds (admin) -----------------------------------------------------

  private async recordRefund(
    tx: DbTransaction,
    input: {
      invoiceId: string | null;
      orderId: string | null;
      customerId: string | null;
      amountCents: number;
      currency: string;
      to: RefundTo;
      reason?: string | null;
    },
  ) {
    await tx.execute(
      `INSERT INTO payments
         (id, invoice_id, order_id, customer_id, amount_cents, currency, method, type, refund_to, status, reason, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        randomUUID(),
        input.invoiceId,
        input.orderId,
        input.customerId,
        input.amountCents,
        input.currency,
        input.to === RefundTo.STORE_CREDIT
          ? PaymentMethod.STORE_CREDIT
          : PaymentMethod.CARD,
        PaymentType.REFUND,
        input.to,
        PaymentStatus.PAID,
        input.reason?.trim() || null,
      ],
    );

    if (input.to === RefundTo.STORE_CREDIT && input.customerId) {
      await tx.execute(
        'INSERT INTO store_credit_entries (id, customer_id, delta_cents, reason) VALUES (?, ?, ?, ?)',
        [
          randomUUID(),
          input.customerId,
          input.amountCents,
          input.reason?.trim() || 'Refund to store credit',
        ],
      );
      await tx.execute(
        'UPDATE customers SET store_credit_cents = store_credit_cents + ? WHERE id = ?',
        [input.amountCents, input.customerId],
      );
    }
  }

  private parseRefundTo(to: string): RefundTo {
    if (to === RefundTo.CARD) return RefundTo.CARD;
    if (to === RefundTo.STORE_CREDIT) return RefundTo.STORE_CREDIT;
    throw new BadRequestException('to must be CARD or STORE_CREDIT');
  }

  async refundOrder(
    user: AuthUser | undefined,
    orderId: string,
    data: { amountCents: number; to: string; reason?: string | null },
  ) {
    this.assertAdmin(user);
    const order = await this.db.queryOne<{
      id: string;
      customer_id: string | null;
      currency: string;
      price_cents: number | null;
      status: OrderStatus;
    }>(
      'SELECT id, customer_id, currency, price_cents, status FROM orders WHERE id = ? LIMIT 1',
      [orderId],
    );
    if (!order) throw new NotFoundException('Order not found');
    if (!Number.isInteger(data.amountCents) || data.amountCents <= 0)
      throw new BadRequestException('amountCents must be a positive integer');
    const to = this.parseRefundTo(data.to);

    await this.db.withTransaction(async (tx) => {
      await this.recordRefund(tx, {
        invoiceId: null,
        orderId: order.id,
        customerId: order.customer_id,
        amountCents: data.amountCents,
        currency: order.currency || 'USD',
        to,
        reason: data.reason,
      });

      const totalRow = await tx.queryOne<{ total: number | string | null }>(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
           FROM payments
          WHERE order_id = ? AND type = ? AND status = ?`,
        [order.id, PaymentType.REFUND, PaymentStatus.PAID],
      );
      const refundedTotal = Number(totalRow?.total ?? 0);
      if (
        order.price_cents != null &&
        refundedTotal >= order.price_cents &&
        order.status !== OrderStatus.REFUNDED
      ) {
        await tx.execute('UPDATE orders SET status = ? WHERE id = ?', [
          OrderStatus.REFUNDED,
          order.id,
        ]);
      }
    });

    return this.orderRefundSummary(orderId);
  }

  private async orderRefundSummary(orderId: string) {
    const payments = await this.db.query<PaymentRow>(
      'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC',
      [orderId],
    );
    const order = await this.db.queryOne<{ id: string; status: OrderStatus }>(
      'SELECT id, status FROM orders WHERE id = ? LIMIT 1',
      [orderId],
    );
    return {
      orderId,
      orderStatus: order?.status ?? null,
      payments: payments.map((p) => this.paymentDto(p)),
    };
  }

  async refundInvoice(
    user: AuthUser | undefined,
    invoiceId: string,
    data: { amountCents: number; to: string; reason?: string | null },
  ) {
    this.assertAdmin(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!Number.isInteger(data.amountCents) || data.amountCents <= 0)
      throw new BadRequestException('amountCents must be a positive integer');
    const to = this.parseRefundTo(data.to);

    await this.db.withTransaction(async (tx) => {
      await this.recordRefund(tx, {
        invoiceId: invoice.id,
        orderId: invoice.order_id,
        customerId: invoice.customer_id,
        amountCents: data.amountCents,
        currency: invoice.currency,
        to,
        reason: data.reason,
      });

      if (invoice.order_id) {
        const totalRow = await tx.queryOne<{ total: number | string | null }>(
          `SELECT COALESCE(SUM(amount_cents), 0) AS total
             FROM payments
            WHERE invoice_id = ? AND type = ? AND status = ?`,
          [invoice.id, PaymentType.REFUND, PaymentStatus.PAID],
        );
        const refundedTotal = Number(totalRow?.total ?? 0);
        if (refundedTotal >= invoice.amount_cents) {
          await tx.execute(
            'UPDATE orders SET status = ? WHERE id = ? AND status <> ?',
            [OrderStatus.REFUNDED, invoice.order_id, OrderStatus.REFUNDED],
          );
        }
      }
    });

    return this.getInvoiceDetail(user, invoiceId);
  }

  // --- net-monthly month-end run -------------------------------------------

  async runMonthEnd(
    user: AuthUser | undefined,
    body: { periodMonth?: string },
  ) {
    this.assertAdmin(user);
    const period =
      body.periodMonth && isValidPeriodMonth(body.periodMonth)
        ? body.periodMonth
        : currentPeriodMonth();

    const customers = await this.db.query<CustomerRow>(
      'SELECT id, user_id, name, email, account_type, store_credit_cents FROM customers WHERE account_type = ?',
      [AccountType.NET_MONTHLY],
    );

    const summary: Array<{
      customerId: string;
      customerName: string;
      amountCents: number;
      orderCount: number;
      invoiceId: string;
    }> = [];

    for (const customer of customers) {
      const existing = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM invoices WHERE customer_id = ? AND kind = ? AND period_month = ? LIMIT 1',
        [customer.id, InvoiceKind.MONTHLY, period],
      );
      if (existing) continue; // guard double-run

      const agg = await this.db.queryOne<{
        total: number | string | null;
        n: number | string | null;
        currency: string | null;
      }>(
        `SELECT COALESCE(SUM(o.price_cents), 0) AS total,
                COUNT(*) AS n,
                MIN(o.currency) AS currency
           FROM orders o
          WHERE o.customer_id = ?
            AND o.status = ?
            AND o.price_cents IS NOT NULL
            AND DATE_FORMAT(o.completed_at, '%Y-%m') = ?
            AND o.id NOT IN (
                  SELECT order_id FROM invoices WHERE order_id IS NOT NULL
                )`,
        [customer.id, OrderStatus.COMPLETED, period],
      );

      const amountCents = Number(agg?.total ?? 0);
      const orderCount = Number(agg?.n ?? 0);
      if (orderCount === 0 || amountCents <= 0) continue;

      const invoiceId = randomUUID();
      const coversText = `${orderCount} order${orderCount === 1 ? '' : 's'} in ${monthLabel(period)}`;
      await this.db.execute(
        `INSERT INTO invoices
           (id, customer_id, order_id, kind, amount_cents, currency, covers_text, status, period_month)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          customer.id,
          null,
          InvoiceKind.MONTHLY,
          amountCents,
          agg?.currency || 'USD',
          coversText,
          InvoiceStatus.AWAITING,
          period,
        ],
      );

      await this.notifyCustomerUser(customer.id, {
        title: 'Monthly statement ready',
        body: coversText,
        link: '/portal/invoices',
      });

      summary.push({
        customerId: customer.id,
        customerName: customer.name,
        amountCents,
        orderCount,
        invoiceId,
      });
    }

    return { periodMonth: period, created: summary };
  }

  async billingSummary(user: AuthUser | undefined) {
    this.assertAdmin(user);
    const period = currentPeriodMonth();

    const outstanding = await this.db.queryOne<{ total: number | string | null }>(
      'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoices WHERE status = ?',
      [InvoiceStatus.AWAITING],
    );
    const paidThisMonth = await this.db.queryOne<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM invoices
        WHERE status = ? AND DATE_FORMAT(paid_at, '%Y-%m') = ?`,
      [InvoiceStatus.PAID, period],
    );
    const storeCredit = await this.db.queryOne<{ total: number | string | null }>(
      'SELECT COALESCE(SUM(store_credit_cents), 0) AS total FROM customers',
    );

    return {
      outstandingCents: Number(outstanding?.total ?? 0),
      paidThisMonthCents: Number(paidThisMonth?.total ?? 0),
      storeCreditOutstandingCents: Number(storeCredit?.total ?? 0),
    };
  }

  // --- customer (CLIENT) ---------------------------------------------------

  async listMyInvoices(user: AuthUser | undefined) {
    const customer = await this.resolveMyCustomer(user);
    const rows = await this.db.query<InvoiceRow & { customer_name: string | null }>(
      `SELECT i.*, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.customer_id = ?
        ORDER BY i.issued_at DESC`,
      [customer.id],
    );
    return {
      invoices: rows.map((r) => this.invoiceDto(r)),
      storeCreditCents: customer.store_credit_cents,
    };
  }

  async payMyInvoice(
    user: AuthUser | undefined,
    invoiceId: string,
    method: string,
  ) {
    const customer = await this.resolveMyCustomer(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice || invoice.customer_id !== customer.id)
      throw new NotFoundException('Invoice not found');
    const m = this.parsePayMethod(method);
    await this.payInvoiceInternal(invoice, m);
    const updated = await this.db.queryOne<
      InvoiceRow & { customer_name: string | null }
    >(
      `SELECT i.*, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.id = ? LIMIT 1`,
      [invoiceId],
    );
    return { invoice: updated ? this.invoiceDto(updated) : null };
  }

  async getMyStoreCredit(user: AuthUser | undefined) {
    const customer = await this.resolveMyCustomer(user);
    const entries = await this.db.query<StoreCreditRow>(
      'SELECT * FROM store_credit_entries WHERE customer_id = ? ORDER BY created_at DESC',
      [customer.id],
    );
    return {
      balanceCents: customer.store_credit_cents,
      entries: entries.map((e) => this.creditEntryDto(e)),
    };
  }

  /** Printable HTML invoice for portal or admin download/print. */
  async getInvoicePrintHtml(user: AuthUser | undefined, invoiceId: string) {
    assertAuthUser(user);
    const invoice = await this.db.queryOne<
      InvoiceRow & { customer_name: string | null; customer_email: string | null }
    >(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.id = ? LIMIT 1`,
      [invoiceId],
    );
    if (!invoice) throw new NotFoundException('Invoice not found');

    const isStaff =
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.ADMIN ||
      user.role === UserRole.SUPPORT ||
      user.role === UserRole.DESIGNER;

    if (!isStaff) {
      const customer = await this.resolveMyCustomer(user);
      if (invoice.customer_id !== customer.id)
        throw new NotFoundException('Invoice not found');
    }

    const amount = (invoice.amount_cents / 100).toFixed(2);
    const issued = new Date(invoice.issued_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const paid = invoice.paid_at
      ? new Date(invoice.paid_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null;
    const ref = invoice.id.slice(0, 8).toUpperCase();
    const covers = escapeHtml(invoice.covers_text || 'Design services');
    const cust = escapeHtml(invoice.customer_name || 'Customer');
    const email = escapeHtml(invoice.customer_email || '');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Invoice ${ref}</title>
<style>
  body{font-family:Georgia,serif;color:#1a1a1a;max-width:640px;margin:40px auto;padding:0 24px}
  h1{font-size:28px;margin:0 0 4px;color:#0b3d5c}
  .sub{color:#666;font-size:13px;margin-bottom:28px}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  th,td{text-align:left;padding:10px 0;border-bottom:1px solid #e5e5e5;font-size:14px}
  .total{font-size:20px;font-weight:700;margin-top:16px}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;
    background:${invoice.status === 'PAID' ? '#e6f6ec' : '#fff4e5'};color:${invoice.status === 'PAID' ? '#1b7a3d' : '#9a5b00'}}
  @media print{body{margin:0}}
</style></head><body>
  <h1>Las Vegas Designs USA</h1>
  <div class="sub">Invoice · ${ref} · <span class="badge">${escapeHtml(invoice.status)}</span></div>
  <p><b>Bill to:</b> ${cust}${email ? `<br/>${email}` : ''}</p>
  <p><b>Issued:</b> ${issued}${paid ? `<br/><b>Paid:</b> ${paid}` : ''}</p>
  ${invoice.period_month ? `<p><b>Period:</b> ${escapeHtml(invoice.period_month)}</p>` : ''}
  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody><tr><td>${covers}</td><td style="text-align:right">${escapeHtml(invoice.currency)} ${amount}</td></tr></tbody>
  </table>
  <div class="total">Total: ${escapeHtml(invoice.currency)} ${amount}</div>
  <script>window.onload=function(){window.print()}</script>
</body></html>`;
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
