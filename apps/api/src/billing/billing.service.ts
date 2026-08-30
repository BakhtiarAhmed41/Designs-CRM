import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
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
import { getEnv } from '../config/env';
import { DbService, DbTransaction } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StripeService } from './stripe.service';

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
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
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
    private mail: MailService,
    private stripe: StripeService,
  ) {}

  private webOrigins() {
    return getEnv()
      .WEB_ORIGIN.split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean);
  }

  private resolveWebBase(requested?: string | null) {
    const origins = this.webOrigins();
    const fallback = origins[0] || 'http://localhost:5173';
    if (!requested) return fallback;
    const cleaned = requested.trim().replace(/\/$/, '');
    return origins.includes(cleaned) ? cleaned : fallback;
  }

  private safeReturnPath(path: string | undefined, fallback: string) {
    if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
      return fallback;
    }
    return path;
  }

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

  /** Completed net-monthly work not yet on an invoice for the period. */
  private async unbilledNetMonthlyCents(opts: {
    customerId?: string;
    periodMonth: string;
  }): Promise<number> {
    const params: unknown[] = [
      AccountType.NET_MONTHLY,
      OrderStatus.COMPLETED,
      opts.periodMonth,
      InvoiceStatus.AWAITING,
      InvoiceStatus.PAID,
    ];
    const customerClause = opts.customerId ? 'AND o.customer_id = ?' : '';
    if (opts.customerId) params.push(opts.customerId);

    const row = await this.db.queryOne<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(o.price_cents), 0) AS total
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE c.account_type = ?
          AND o.status = ?
          AND o.price_cents IS NOT NULL
          AND DATE_FORMAT(o.completed_at, '%Y-%m') = ?
          AND o.id NOT IN (
                SELECT order_id FROM invoices
                 WHERE order_id IS NOT NULL
                   AND status IN (?, ?)
              )
          ${customerClause}`,
      params,
    );
    return Number(row?.total ?? 0);
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
    filters: { status?: string; customerId?: string; q?: string },
  ) {
    this.assertAdmin(user);
    await this.collapseOrderInvoiceDupes();
    const where: string[] = [];
    const params: unknown[] = [];
    const statuses = Object.values(InvoiceStatus) as string[];
    if (filters.status && statuses.includes(filters.status)) {
      where.push('i.status = ?');
      params.push(filters.status);
    } else {
      where.push('i.status <> ?');
      params.push(InvoiceStatus.CANCELLED);
    }
    if (filters.customerId) {
      where.push('i.customer_id = ?');
      params.push(filters.customerId);
    }
    if (filters.q) {
      where.push(
        `(c.name LIKE ? OR i.covers_text LIKE ? OR i.id LIKE ? OR o.human_ref LIKE ?)`,
      );
      const like = `%${filters.q}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<InvoiceRow & { customer_name: string | null }>(
      `SELECT i.*, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN orders o ON o.id = i.order_id
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

      const existing = await this.reuseOrderInvoice(data.orderId);
      if (existing) {
        if (
          existing.status === InvoiceStatus.AWAITING &&
          (existing.amount_cents !== data.amountCents ||
            (data.coversText?.trim() && data.coversText.trim() !== existing.covers_text))
        ) {
          await this.db.execute(
            'UPDATE invoices SET amount_cents = ?, covers_text = COALESCE(?, covers_text) WHERE id = ?',
            [data.amountCents, data.coversText?.trim() || null, existing.id],
          );
        }
        return this.getInvoiceDetail(user, existing.id);
      }
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

  /**
   * After a customer accepts a quote: create a per-order invoice + pay link.
   * No admin check — the customer already owns the order.
   */
  async billPayPerOrderQuote(data: {
    customerId: string;
    orderId: string;
    amountCents: number;
    coversText?: string | null;
  }) {
    if (!Number.isInteger(data.amountCents) || data.amountCents <= 0) return;
    const customer = await this.getCustomerRow(data.customerId);
    if (!customer || customer.account_type === AccountType.NET_MONTHLY) return;

    let invoice = await this.reuseOrderInvoice(data.orderId);
    if (invoice) {
      if (
        invoice.status === InvoiceStatus.AWAITING &&
        (invoice.amount_cents !== data.amountCents ||
          (data.coversText?.trim() &&
            data.coversText.trim() !== invoice.covers_text))
      ) {
        await this.db.execute(
          'UPDATE invoices SET amount_cents = ?, covers_text = COALESCE(?, covers_text) WHERE id = ?',
          [data.amountCents, data.coversText?.trim() || null, invoice.id],
        );
        invoice = (await this.getInvoiceRow(invoice.id)) ?? invoice;
      }
    } else {
      const id = randomUUID();
      const currencyRow = await this.db.queryOne<{ currency: string | null }>(
        'SELECT currency FROM orders WHERE id = ? LIMIT 1',
        [data.orderId],
      );
      await this.db.execute(
        `INSERT INTO invoices
           (id, customer_id, order_id, kind, amount_cents, currency, covers_text, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.customerId,
          data.orderId,
          InvoiceKind.PER_ORDER,
          data.amountCents,
          currencyRow?.currency || 'USD',
          data.coversText?.trim() || null,
          InvoiceStatus.AWAITING,
        ],
      );
      invoice = await this.getInvoiceRow(id);
      await this.notifyCustomerUser(data.customerId, {
        title: 'Invoice ready',
        body: 'Your quote was accepted. Please pay to start the order.',
        link: '/portal/invoices',
      });
    }

    if (invoice && invoice.status === InvoiceStatus.AWAITING) {
      await this.ensurePendingPayLink(invoice);
    }
  }

  /** Extra format / add-on bill. Never reuse the original job invoice. */
  async createAddonInvoice(
    user: AuthUser | undefined,
    data: {
      customerId: string;
      orderId: string;
      amountCents: number;
      coversText: string;
    },
  ) {
    this.assertAdmin(user);
    const customer = await this.getCustomerRow(data.customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (!Number.isInteger(data.amountCents) || data.amountCents <= 0)
      throw new BadRequestException('amountCents must be a positive integer');
    const order = await this.db.queryOne<{ currency: string | null }>(
      'SELECT currency FROM orders WHERE id = ? LIMIT 1',
      [data.orderId],
    );
    if (!order) throw new NotFoundException('Order not found');

    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO invoices
         (id, customer_id, order_id, kind, amount_cents, currency, covers_text, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.customerId,
        data.orderId,
        InvoiceKind.ADD_ON,
        data.amountCents,
        order.currency || 'USD',
        data.coversText.trim(),
        InvoiceStatus.AWAITING,
      ],
    );
    await this.notifyCustomerUser(data.customerId, {
      title: 'New invoice',
      body: data.coversText.trim(),
      link: '/portal/invoices',
    });
    return this.getInvoiceDetail(user, id);
  }

  async releasePaidFormatExport(invoiceId: string) {
    const req = await this.db.queryOne<{
      id: string;
      order_id: string;
      requested_format: string;
      delivery_file_id: string | null;
      status: string;
      human_ref: string | null;
      order_name: string | null;
      client_user_id: string | null;
    }>(
      `SELECT f.id, f.order_id, f.requested_format, f.delivery_file_id, f.status,
              o.human_ref, o.name AS order_name, o.client_user_id
         FROM format_requests f
         JOIN orders o ON o.id = f.order_id
        WHERE f.invoice_id = ? LIMIT 1`,
      [invoiceId],
    );
    if (!req || req.status === 'DONE' || req.status === 'CANCELLED') return;
    if (req.delivery_file_id) {
      await this.db.execute(
        `UPDATE deliveries d
           JOIN delivery_files df ON df.delivery_id = d.id
            SET d.released_at = COALESCE(d.released_at, NOW())
          WHERE df.id = ?`,
        [req.delivery_file_id],
      );
    }
    await this.db.execute(
      `UPDATE format_requests SET status = ? WHERE id = ?`,
      ['DONE', req.id],
    );
    try {
      await this.db.execute(
        'UPDATE format_requests SET resolved_at = NOW() WHERE id = ?',
        [req.id],
      );
    } catch {
      /* older databases may not have resolved_at */
    }
    const ref = req.human_ref ?? req.order_name ?? req.order_id.slice(0, 6);
    if (req.client_user_id) {
      await this.notifications.createFor(req.client_user_id, {
        title: `${req.requested_format} file is ready`,
        body: `Your ${req.requested_format} export for ${ref} is in Files.`,
        link: '/portal/files',
      });
    }
    const order = await this.db.queryOne<{ customer_id: string | null }>(
      'SELECT customer_id FROM orders WHERE id = ? LIMIT 1',
      [req.order_id],
    );
    if (order?.customer_id) {
      const customer = await this.getCustomerRow(order.customer_id);
      if (customer?.email) {
        await this.mail.sendFormatReady(customer.email, req.requested_format, ref);
      }
    }
  }

  /** One open (or already paid) per-order invoice. Extra awaiting copies are cancelled. */
  private async reuseOrderInvoice(orderId: string): Promise<InvoiceRow | null> {
    await this.collapseOrderInvoiceDupes(undefined, orderId);
    const paid = await this.db.queryOne<InvoiceRow>(
      `SELECT * FROM invoices
        WHERE order_id = ? AND kind = ? AND status = ?
        ORDER BY paid_at DESC, issued_at DESC
        LIMIT 1`,
      [orderId, InvoiceKind.PER_ORDER, InvoiceStatus.PAID],
    );
    if (paid) return paid;
    return this.db.queryOne<InvoiceRow>(
      `SELECT * FROM invoices
        WHERE order_id = ? AND kind = ? AND status = ?
        ORDER BY issued_at ASC
        LIMIT 1`,
      [orderId, InvoiceKind.PER_ORDER, InvoiceStatus.AWAITING],
    );
  }

  /**
   * If an order is already paid, cancel leftover pending copies.
   * If several pending copies exist, keep the oldest and cancel the rest.
   */
  private async collapseOrderInvoiceDupes(customerId?: string, orderId?: string) {
    const where = ['kind = ?', 'order_id IS NOT NULL', 'status IN (?, ?)'];
    const params: unknown[] = [
      InvoiceKind.PER_ORDER,
      InvoiceStatus.AWAITING,
      InvoiceStatus.PAID,
    ];
    if (customerId) {
      where.push('customer_id = ?');
      params.push(customerId);
    }
    if (orderId) {
      where.push('order_id = ?');
      params.push(orderId);
    }

    const rows = await this.db.query<{
      id: string;
      order_id: string;
      status: string;
    }>(
      `SELECT id, order_id, status FROM invoices
        WHERE ${where.join(' AND ')}
        ORDER BY issued_at ASC`,
      params,
    );

    const byOrder = new Map<string, { id: string; status: string }[]>();
    for (const r of rows) {
      const list = byOrder.get(r.order_id) ?? [];
      list.push({ id: r.id, status: r.status });
      byOrder.set(r.order_id, list);
    }

    const cancelIds: string[] = [];
    for (const list of byOrder.values()) {
      const paid = list.filter((i) => i.status === InvoiceStatus.PAID);
      const awaiting = list.filter((i) => i.status === InvoiceStatus.AWAITING);
      if (paid.length > 0) {
        cancelIds.push(...awaiting.map((i) => i.id));
      } else if (awaiting.length > 1) {
        cancelIds.push(...awaiting.slice(1).map((i) => i.id));
      }
    }
    if (cancelIds.length === 0) return;
    await this.db.execute(
      `UPDATE invoices SET status = ? WHERE id IN (${cancelIds.map(() => '?').join(',')})`,
      [InvoiceStatus.CANCELLED, ...cancelIds],
    );
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
    const customer = await this.getCustomerRow(invoice.customer_id);
    if (customer?.email) {
      const amountLabel = `${(invoice.amount_cents / 100).toFixed(2)} ${invoice.currency}`;
      await this.mail.sendInvoiceReminder(
        customer.email,
        invoice.covers_text ?? 'your invoice',
        amountLabel,
        payLink.url,
      );
    }

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
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay a cancelled invoice');
    }
    if (invoice.status !== InvoiceStatus.AWAITING) {
      throw new BadRequestException('Invoice is not awaiting payment');
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
      // Staff bookkeeping: record money received outside the portal.
      // TODO(payment): integrate Stripe once keys are provided
      await this.db.withTransaction(async (tx) => {
        const locked = await tx.queryOne<{ status: InvoiceStatus }>(
          'SELECT status FROM invoices WHERE id = ? LIMIT 1 FOR UPDATE',
          [invoice.id],
        );
        if (!locked || locked.status === InvoiceStatus.PAID) return;
        if (locked.status === InvoiceStatus.CANCELLED) {
          throw new BadRequestException('Cannot pay a cancelled invoice');
        }
        if (locked.status !== InvoiceStatus.AWAITING) {
          throw new BadRequestException('Invoice is not awaiting payment');
        }
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
            PaymentMethod.CARD,
            PaymentType.CHARGE,
            PaymentStatus.PAID,
          ],
        );
        await tx.execute(
          'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
          [InvoiceStatus.PAID, invoice.id],
        );
      });
    }

    await this.advanceOrderAfterPayment(invoice.order_id);
    await this.releasePaidFormatExport(invoice.id);
  }

  private async advanceOrderAfterPayment(orderId: string | null) {
    if (!orderId) return;
    await this.db.execute(
      `UPDATE orders SET status = ?
        WHERE id = ? AND status = ?`,
      [OrderStatus.IN_PROGRESS, orderId, OrderStatus.PENDING_PAYMENT],
    );
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
    if (invoice.status === InvoiceStatus.CANCELLED)
      throw new BadRequestException('Cannot create a pay link for a cancelled invoice');
    if (invoice.status !== InvoiceStatus.AWAITING)
      throw new BadRequestException('Invoice is not awaiting payment');

    const payment = await this.ensurePendingPayLink(invoice);
    return { token: payment.pay_link_token!, url: `/pay/${payment.pay_link_token}` };
  }

  private async ensurePendingPayLink(invoice: InvoiceRow): Promise<PaymentRow> {
    const existing = await this.db.queryOne<PaymentRow>(
      `SELECT * FROM payments
        WHERE invoice_id = ? AND method = ? AND status = ? AND pay_link_token IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [invoice.id, PaymentMethod.LINK, PaymentStatus.PENDING],
    );
    if (existing?.pay_link_token) return existing;

    const token = randomBytes(24).toString('hex');
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO payments
         (id, invoice_id, order_id, customer_id, amount_cents, currency, method, type, pay_link_token, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
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
    const created = await this.db.queryOne<PaymentRow>(
      'SELECT * FROM payments WHERE id = ? LIMIT 1',
      [id],
    );
    if (!created) throw new BadRequestException('Could not create payment link');
    return created;
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
      stripeEnabled: this.stripe.isConfigured(),
    };
  }

  async startCheckoutForPayLink(token: string, returnOrigin?: string) {
    const payment = await this.db.queryOne<PaymentRow>(
      'SELECT * FROM payments WHERE pay_link_token = ? LIMIT 1',
      [token],
    );
    if (!payment || !payment.invoice_id)
      throw new NotFoundException('Payment link not found');
    const invoice = await this.getInvoiceRow(payment.invoice_id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const web = this.resolveWebBase(returnOrigin);
    return this.startStripeCheckout(invoice, payment, {
      successPath: `/pay/${token}?status=success`,
      cancelPath: `/pay/${token}?status=canceled`,
      web,
    });
  }

  async confirmPayLink(token: string) {
    const payment = await this.db.queryOne<PaymentRow>(
      'SELECT * FROM payments WHERE pay_link_token = ? LIMIT 1',
      [token],
    );
    if (!payment || !payment.invoice_id)
      throw new NotFoundException('Payment link not found');
    await this.confirmStripePayment(payment);
    return this.getPayLinkSummary(token);
  }

  /** PUBLIC: start Stripe Checkout for this pay-link. */
  async payViaPayLink(token: string, returnOrigin?: string) {
    return this.startCheckoutForPayLink(token, returnOrigin);
  }

  private async startStripeCheckout(
    invoice: InvoiceRow,
    payment: PaymentRow,
    dest: { successPath: string; cancelPath: string; web: string },
  ) {
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid');
    }
    if (invoice.status !== InvoiceStatus.AWAITING) {
      throw new BadRequestException('Invoice is not awaiting payment');
    }
    if (!this.stripe.isConfigured()) {
      throw new BadRequestException('Card checkout is not configured');
    }
    if (payment.stripe_checkout_session_id) {
      try {
        const existing = await this.stripe.retrieveSession(
          payment.stripe_checkout_session_id,
        );
        if (
          existing.status === 'open' &&
          existing.url &&
          existing.amount_total === invoice.amount_cents
        ) {
          return { url: existing.url, sessionId: existing.id };
        }
        if (existing.payment_status === 'paid') {
          await this.fulfillStripeSession(existing);
          throw new BadRequestException('Invoice is already paid');
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
      }
    }

    const customer = await this.getCustomerRow(invoice.customer_id);
    const session = await this.stripe.createInvoiceCheckout({
      amountCents: invoice.amount_cents,
      currency: invoice.currency,
      productName: invoice.covers_text || 'Design invoice',
      successUrl: `${dest.web}${dest.successPath}`,
      cancelUrl: `${dest.web}${dest.cancelPath}`,
      invoiceId: invoice.id,
      paymentId: payment.id,
      customerEmail: customer?.email,
    });
    await this.db.execute(
      'UPDATE payments SET stripe_checkout_session_id = ? WHERE id = ?',
      [session.id, payment.id],
    );
    return { url: session.url!, sessionId: session.id };
  }

  private async confirmStripePayment(payment: PaymentRow) {
    if (!payment.stripe_checkout_session_id || !this.stripe.isConfigured()) {
      return;
    }
    const session = await this.stripe.retrieveSession(
      payment.stripe_checkout_session_id,
    );
    if (session.payment_status === 'paid') {
      await this.fulfillStripeSession(session);
    }
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const event = this.stripe.constructWebhookEvent(rawBody, signature);
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as {
        id: string;
        payment_status?: string;
        payment_intent?: string | { id: string } | null;
        metadata?: Record<string, string> | null;
        client_reference_id?: string | null;
      };
      if (session.payment_status && session.payment_status !== 'paid') return;
      await this.fulfillStripeSession(session);
    }
  }

  private async fulfillStripeSession(session: {
    id: string;
    payment_intent?: string | { id: string } | null;
    metadata?: Record<string, string> | null;
    client_reference_id?: string | null;
  }) {
    const paymentId = session.metadata?.paymentId;
    const invoiceId =
      session.metadata?.invoiceId || session.client_reference_id || null;
    let payment = paymentId
      ? await this.db.queryOne<PaymentRow>(
          'SELECT * FROM payments WHERE id = ? LIMIT 1',
          [paymentId],
        )
      : null;
    if (!payment) {
      payment = await this.db.queryOne<PaymentRow>(
        'SELECT * FROM payments WHERE stripe_checkout_session_id = ? LIMIT 1',
        [session.id],
      );
    }
    if (!payment && invoiceId) {
      payment = await this.db.queryOne<PaymentRow>(
        `SELECT * FROM payments
          WHERE invoice_id = ? AND status = ? AND type = ?
          ORDER BY created_at DESC LIMIT 1`,
        [invoiceId, PaymentStatus.PENDING, PaymentType.CHARGE],
      );
    }
    const resolvedInvoiceId = payment?.invoice_id || invoiceId;
    if (!resolvedInvoiceId) return;
    const invoice = await this.getInvoiceRow(resolvedInvoiceId);
    if (!invoice) return;
    if (invoice.status === InvoiceStatus.PAID) return;

    const intentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    await this.db.withTransaction(async (tx) => {
      const locked = await tx.queryOne<{ status: InvoiceStatus }>(
        'SELECT status FROM invoices WHERE id = ? LIMIT 1 FOR UPDATE',
        [invoice.id],
      );
      if (!locked || locked.status === InvoiceStatus.PAID) return;
      if (locked.status !== InvoiceStatus.AWAITING) return;

      if (payment) {
        await tx.execute(
          `UPDATE payments
              SET status = ?, method = ?, paid_at = NOW(),
                  stripe_checkout_session_id = ?,
                  stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id)
            WHERE id = ?`,
          [
            PaymentStatus.PAID,
            PaymentMethod.CARD,
            session.id,
            intentId,
            payment.id,
          ],
        );
      } else {
        await tx.execute(
          `INSERT INTO payments
             (id, invoice_id, order_id, customer_id, amount_cents, currency, method, type, status, paid_at, stripe_checkout_session_id, stripe_payment_intent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
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
            session.id,
            intentId,
          ],
        );
      }
      await tx.execute(
        `UPDATE payments SET status = ?
          WHERE invoice_id = ? AND status = ? AND id <> ?`,
        [
          PaymentStatus.FAILED,
          invoice.id,
          PaymentStatus.PENDING,
          payment?.id ?? '',
        ],
      );
      await tx.execute(
        'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
        [InvoiceStatus.PAID, invoice.id],
      );
    });

    await this.advanceOrderAfterPayment(invoice.order_id);
    await this.releasePaidFormatExport(invoice.id);
    await this.notifyCustomerUser(invoice.customer_id, {
      title: 'Payment received',
      body: `We received your payment for ${invoice.covers_text ?? 'your invoice'}.`,
      link: '/portal/invoices',
    });
  }

  async startCheckoutForMyInvoice(
    user: AuthUser | undefined,
    invoiceId: string,
    opts?: { returnOrigin?: string; returnPath?: string },
  ) {
    const customer = await this.resolveMyCustomer(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice || invoice.customer_id !== customer.id)
      throw new NotFoundException('Invoice not found');
    const payment = await this.ensurePendingPayLink(invoice);
    const web = this.resolveWebBase(opts?.returnOrigin);
    const returnPath = this.safeReturnPath(
      opts?.returnPath,
      '/portal/invoices',
    );
    return this.startStripeCheckout(invoice, payment, {
      successPath: `${returnPath}${returnPath.includes('?') ? '&' : '?'}paid=1`,
      cancelPath: `${returnPath}${returnPath.includes('?') ? '&' : '?'}canceled=1`,
      web,
    });
  }

  async startCheckoutForMyOrder(
    user: AuthUser | undefined,
    orderId: string,
    opts?: { returnOrigin?: string },
  ) {
    const customer = await this.resolveMyCustomer(user);
    const invoice = await this.db.queryOne<InvoiceRow>(
      `SELECT * FROM invoices
        WHERE order_id = ? AND customer_id = ? AND status = ?
        ORDER BY issued_at DESC LIMIT 1`,
      [orderId, customer.id, InvoiceStatus.AWAITING],
    );
    if (!invoice) {
      throw new NotFoundException('No unpaid invoice for this order');
    }
    return this.startCheckoutForMyInvoice(user, invoice.id, {
      returnOrigin: opts?.returnOrigin,
      returnPath: `/portal/orders/${orderId}`,
    });
  }

  async confirmMyInvoice(user: AuthUser | undefined, invoiceId: string) {
    const customer = await this.resolveMyCustomer(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice || invoice.customer_id !== customer.id)
      throw new NotFoundException('Invoice not found');
    const payment = await this.db.queryOne<PaymentRow>(
      `SELECT * FROM payments
        WHERE invoice_id = ? AND stripe_checkout_session_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [invoiceId],
    );
    if (payment) await this.confirmStripePayment(payment);
    const updated = await this.getInvoiceRow(invoiceId);
    return { invoice: updated ? this.invoiceDto(updated) : null };
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

  private async refundStripeCharge(opts: {
    invoiceId?: string | null;
    orderId?: string | null;
    amountCents: number;
    to: RefundTo;
  }) {
    if (opts.to !== RefundTo.CARD || !this.stripe.isConfigured()) return;
    const charge = await this.db.queryOne<{ stripe_payment_intent_id: string | null }>(
      `SELECT stripe_payment_intent_id FROM payments
        WHERE ${opts.invoiceId ? 'invoice_id = ?' : 'order_id = ?'}
          AND type = ? AND status = ? AND stripe_payment_intent_id IS NOT NULL
        ORDER BY paid_at DESC, created_at DESC
        LIMIT 1`,
      [
        opts.invoiceId ?? opts.orderId,
        PaymentType.CHARGE,
        PaymentStatus.PAID,
      ],
    );
    if (charge?.stripe_payment_intent_id) {
      await this.stripe.refundPaymentIntent(
        charge.stripe_payment_intent_id,
        opts.amountCents,
      );
    }
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
    const alreadyRow = await this.db.queryOne<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM payments
        WHERE order_id = ? AND type = ? AND status = ?`,
      [order.id, PaymentType.REFUND, PaymentStatus.PAID],
    );
    const alreadyRefunded = Number(alreadyRow?.total ?? 0);
    if (order.price_cents != null) {
      const remaining = order.price_cents - alreadyRefunded;
      if (data.amountCents > remaining) {
        throw new BadRequestException(
          remaining <= 0
            ? 'This order is already fully refunded'
            : `Refund exceeds remaining amount (${remaining} cents)`,
        );
      }
    }
    await this.refundStripeCharge({
      orderId: order.id,
      amountCents: data.amountCents,
      to,
    });

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

      const refundedTotal = alreadyRefunded + data.amountCents;
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
    if (invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException('Only paid invoices can be refunded');
    }
    if (!Number.isInteger(data.amountCents) || data.amountCents <= 0)
      throw new BadRequestException('amountCents must be a positive integer');
    const to = this.parseRefundTo(data.to);
    const alreadyRow = await this.db.queryOne<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM payments
        WHERE invoice_id = ? AND type = ? AND status = ?`,
      [invoice.id, PaymentType.REFUND, PaymentStatus.PAID],
    );
    const alreadyRefunded = Number(alreadyRow?.total ?? 0);
    const remaining = invoice.amount_cents - alreadyRefunded;
    if (data.amountCents > remaining) {
      throw new BadRequestException(
        remaining <= 0
          ? 'Invoice is already fully refunded'
          : `Refund exceeds remaining amount (${remaining} cents)`,
      );
    }
    await this.refundStripeCharge({
      invoiceId: invoice.id,
      orderId: invoice.order_id,
      amountCents: data.amountCents,
      to,
    });

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
        const refundedTotal = alreadyRefunded + data.amountCents;
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
      const existing = await this.db.queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM invoices WHERE customer_id = ? AND kind = ? AND period_month = ? LIMIT 1',
        [customer.id, InvoiceKind.MONTHLY, period],
      );
      if (existing && existing.status !== InvoiceStatus.CANCELLED) continue;

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
                  SELECT order_id FROM invoices
                   WHERE order_id IS NOT NULL
                     AND status IN (?, ?)
                )`,
        [
          customer.id,
          OrderStatus.COMPLETED,
          period,
          InvoiceStatus.AWAITING,
          InvoiceStatus.PAID,
        ],
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
    await this.collapseOrderInvoiceDupes();
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
    const unbilled = await this.unbilledNetMonthlyCents({ periodMonth: period });

    return {
      outstandingCents: Number(outstanding?.total ?? 0),
      paidThisMonthCents: Number(paidThisMonth?.total ?? 0),
      storeCreditOutstandingCents: Number(storeCredit?.total ?? 0),
      netMonthlyUnbilledCents: unbilled,
    };
  }

  // --- customer (CLIENT) ---------------------------------------------------

  async listMyInvoices(user: AuthUser | undefined) {
    const customer = await this.resolveMyCustomer(user);
    await this.collapseOrderInvoiceDupes(customer.id);
    const rows = await this.db.query<InvoiceRow & { customer_name: string | null }>(
      `SELECT i.*, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.customer_id = ? AND i.status <> ?
        ORDER BY i.issued_at DESC`,
      [customer.id, InvoiceStatus.CANCELLED],
    );
    const seenOrders = new Set<string>();
    const invoices = rows.filter((r) => {
      if (r.kind !== InvoiceKind.PER_ORDER || !r.order_id) return true;
      if (seenOrders.has(r.order_id)) return false;
      seenOrders.add(r.order_id);
      return true;
    });
    const unbilledMonthCents =
      customer.account_type === AccountType.NET_MONTHLY
        ? await this.unbilledNetMonthlyCents({
            customerId: customer.id,
            periodMonth: currentPeriodMonth(),
          })
        : 0;

    return {
      invoices: invoices.map((r) => this.invoiceDto(r)),
      storeCreditCents: customer.store_credit_cents,
      unbilledMonthCents,
    };
  }

  async myInvoiceSummary(user: AuthUser | undefined) {
    const customer = await this.resolveMyCustomer(user);
    await this.collapseOrderInvoiceDupes(customer.id);
    const row = await this.db.queryOne<{ n: number | string; total: number | string }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total
         FROM invoices
        WHERE customer_id = ? AND status = ?`,
      [customer.id, InvoiceStatus.AWAITING],
    );
    return {
      awaitingCount: Number(row?.n ?? 0),
      awaitingCents: Number(row?.total ?? 0),
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
    if (m === PaymentMethod.CARD) {
      return this.startCheckoutForMyInvoice(user, invoiceId);
    }
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
      InvoiceRow & {
        customer_name: string | null;
        customer_email: string | null;
        customer_phone: string | null;
        order_ref: string | null;
        order_name: string | null;
      }
    >(
      `SELECT i.*,
              c.name AS customer_name,
              c.email AS customer_email,
              c.phone AS customer_phone,
              o.human_ref AS order_ref,
              o.name AS order_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN orders o ON o.id = i.order_id
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

    const payments = await this.db.query<PaymentRow>(
      `SELECT * FROM payments
        WHERE invoice_id = ?
        ORDER BY created_at ASC`,
      [invoiceId],
    );

    return buildInvoicePrintHtml(invoice, payments, invoiceLogoSrc());
  }
}

function invoiceLogoSrc() {
  const candidates = [
    join(__dirname, 'assets', 'lvd-logo.png'),
    join(__dirname, '..', 'assets', 'lvd-logo.png'),
    join(__dirname, '..', '..', 'assets', 'lvd-logo.png'),
    join(process.cwd(), 'assets', 'lvd-logo.png'),
    join(process.cwd(), 'apps', 'api', 'assets', 'lvd-logo.png'),
    join(process.cwd(), '..', 'web', 'public', 'lvd-logo.png'),
    join(process.cwd(), 'apps', 'web', 'public', 'lvd-logo.png'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  }
  return '';
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatInvoiceMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function formatInvoiceDate(value: Date | string | null | undefined) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function invoiceStatusLabel(status: InvoiceStatus) {
  if (status === InvoiceStatus.PAID) return 'Paid';
  if (status === InvoiceStatus.CANCELLED) return 'Cancelled';
  return 'Due';
}

function paymentMethodLabel(method: PaymentMethod) {
  if (method === PaymentMethod.STORE_CREDIT) return 'Store credit';
  if (method === PaymentMethod.LINK) return 'Payment link';
  return 'Card';
}

function buildInvoicePrintHtml(
  invoice: InvoiceRow & {
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    order_ref: string | null;
    order_name: string | null;
  },
  payments: PaymentRow[],
  logoSrc = '',
) {
  const ref = invoice.id.slice(0, 8).toUpperCase();
  const money = (cents: number) => formatInvoiceMoney(cents, invoice.currency);
  const issued = formatInvoiceDate(invoice.issued_at);
  const paidOn = formatInvoiceDate(invoice.paid_at);
  const period = invoice.period_month
    ? monthLabel(invoice.period_month)
    : '';
  const kindLabel =
    invoice.kind === InvoiceKind.MONTHLY
      ? 'Monthly statement'
      : invoice.kind === InvoiceKind.ADD_ON
        ? 'Add-on export'
        : 'Design services';
  const description = invoice.covers_text?.trim() || kindLabel;
  const orderHint = [invoice.order_ref, invoice.order_name]
    .filter(Boolean)
    .join(' · ');
  const charges = payments.filter(
    (p) => p.type === PaymentType.CHARGE && p.status === PaymentStatus.PAID,
  );
  const refunds = payments.filter((p) => p.type === PaymentType.REFUND);
  const chargedCents = charges.reduce((sum, p) => sum + p.amount_cents, 0);
  const refundedCents = refunds.reduce((sum, p) => sum + p.amount_cents, 0);
  const statusClass =
    invoice.status === InvoiceStatus.PAID
      ? 'ok'
      : invoice.status === InvoiceStatus.CANCELLED
        ? 'off'
        : 'due';

  const billLines = [
    `<div class="who">${escapeHtml(invoice.customer_name || 'Customer')}</div>`,
    invoice.customer_email
      ? `<div class="soft">${escapeHtml(invoice.customer_email)}</div>`
      : '',
    invoice.customer_phone
      ? `<div class="soft">${escapeHtml(invoice.customer_phone)}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const paymentRows = [...charges, ...refunds]
    .map((p) => {
      const when = formatInvoiceDate(p.paid_at || p.created_at);
      const label =
        p.type === PaymentType.REFUND
          ? `Refund${p.refund_to ? ` to ${paymentMethodLabel(p.refund_to as PaymentMethod)}` : ''}`
          : paymentMethodLabel(p.method);
      const signed =
        p.type === PaymentType.REFUND ? `−${money(p.amount_cents)}` : money(p.amount_cents);
      return `<tr>
        <td>${escapeHtml(when || '—')}</td>
        <td>${escapeHtml(label)}</td>
        <td class="num">${escapeHtml(signed)}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Invoice LVD-${ref}</title>
<style>
  :root {
    --navy: #143F65;
    --navy-d: #0E2E4A;
    --ink: #16202a;
    --muted: #6b7380;
    --line: #e4e7ec;
    --paper: #ffffff;
    --ok: #1e5c38;
    --due: #8a5a10;
    --off: #5c6570;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #eceff3; color: var(--ink); }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    line-height: 1.45;
  }
  .toolbar {
    max-width: 760px;
    margin: 20px auto 0;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .toolbar button {
    font: inherit;
    font-weight: 600;
    font-size: 12.5px;
    color: #fff;
    background: var(--navy);
    border: 0;
    border-radius: 8px;
    padding: 8px 14px;
    cursor: pointer;
  }
  .sheet {
    width: 8.5in;
    min-height: 11in;
    margin: 16px auto 40px;
    background: var(--paper);
    padding: 0.72in 0.78in 0.64in;
    box-shadow: 0 18px 50px rgba(14, 46, 74, 0.10);
    display: flex;
    flex-direction: column;
  }
  .brand {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 28px;
  }
  .mark {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo {
    height: 48px;
    width: auto;
    max-width: 120px;
    object-fit: contain;
    flex-shrink: 0;
    background: #fff;
    border-radius: 6px;
  }
  .studio {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--navy);
  }
  .place { margin-top: 4px; font-size: 12.5px; color: var(--muted); }
  .doc-title {
    text-align: right;
  }
  .doc-title h1 {
    font-family: Palatino, "Palatino Linotype", Georgia, serif;
    font-size: 40px;
    font-weight: 400;
    letter-spacing: 0.04em;
    color: var(--navy-d);
    line-height: 1;
  }
  .doc-title .no {
    margin-top: 8px;
    font-size: 13px;
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  .stamp {
    display: inline-block;
    margin-top: 10px;
    padding: 3px 9px;
    border: 1px solid currentColor;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .stamp.ok { color: var(--ok); }
  .stamp.due { color: var(--due); }
  .stamp.off { color: var(--off); }
  .rule {
    height: 5px;
    margin: 28px 0 32px;
    border-top: 1px solid var(--navy);
    border-bottom: 2.5px solid var(--navy);
  }
  .meta {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 36px 48px;
  }
  .k {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .who { font-size: 16px; font-weight: 600; color: var(--navy-d); }
  .soft { font-size: 13px; color: var(--muted); margin-top: 3px; }
  .facts { display: grid; grid-template-columns: 92px 1fr; gap: 7px 14px; font-size: 13.5px; }
  .facts dt { color: var(--muted); }
  .facts dd { color: var(--ink); }
  table { width: 100%; border-collapse: collapse; }
  .items { margin-top: 40px; }
  .items th {
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 0 0 10px;
    border-bottom: 1px solid var(--navy);
  }
  .items th.num, .pay th.num { text-align: right; }
  .items td {
    padding: 16px 0;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    font-size: 14px;
  }
  .item-name { font-weight: 600; color: var(--ink); }
  .item-sub { margin-top: 3px; font-size: 12.5px; color: var(--muted); }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals {
    width: 280px;
    margin: 8px 0 0 auto;
  }
  .totals tr td { padding: 7px 0; font-size: 13.5px; color: var(--muted); }
  .totals tr td.num { color: var(--ink); }
  .totals .grand td {
    padding-top: 12px;
    border-top: 2px solid var(--navy);
    font-family: Palatino, "Palatino Linotype", Georgia, serif;
    font-size: 20px;
    color: var(--navy-d);
  }
  .note {
    margin-top: 28px;
    padding: 14px 16px;
    background: #f4f7fa;
    font-size: 13px;
    color: var(--navy-d);
  }
  .pay { margin-top: 36px; }
  .pay table { margin-top: 8px; }
  .pay th {
    text-align: left;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 0 0 8px;
    border-bottom: 1px solid var(--line);
  }
  .pay td { padding: 9px 0; font-size: 13px; border-bottom: 1px solid var(--line); }
  .foot {
    margin-top: auto;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    gap: 24px;
    font-size: 11.5px;
    color: var(--muted);
    line-height: 1.55;
  }
  .foot strong { display: block; color: var(--navy); font-size: 12px; margin-bottom: 2px; }
  /* Browser “Margins: None” drops @page margins. Keep space on the page itself. */
  @page { size: A4; margin: 0; }
  @media print {
    html {
      background: #fff !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    body {
      background: #fff !important;
      margin: 0 !important;
      padding: 18mm 16mm 16mm !important;
    }
    .toolbar { display: none !important; }
    .page {
      padding: 0 !important;
    }
    .sheet {
      width: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      display: block !important;
    }
    .foot { margin-top: 48px; }
    .note { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .logo { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <span>Use Print and choose “Save as PDF” for a clean copy.</span>
    <button type="button" onclick="window.print()">Print</button>
  </div>
  <div class="page">
  <article class="sheet">
    <header class="brand">
      <div class="mark">
        ${
          logoSrc
            ? `<img class="logo" src="${logoSrc}" alt="Las Vegas Designs USA" />`
            : `<div class="logo" aria-hidden="true"></div>`
        }
        <div>
          <div class="studio">Las Vegas Designs</div>
          <div class="place">USA · Custom embroidery &amp; design</div>
        </div>
      </div>
      <div class="doc-title">
        <h1>Invoice</h1>
        <div class="no">No. LVD-${ref}</div>
        <div class="stamp ${statusClass}">${escapeHtml(invoiceStatusLabel(invoice.status))}</div>
      </div>
    </header>
    <div class="rule"></div>
    <section class="meta">
      <div>
        <div class="k">Billed to</div>
        ${billLines}
      </div>
      <div>
        <div class="k">Details</div>
        <dl class="facts">
          <dt>Issued</dt><dd>${escapeHtml(issued || '—')}</dd>
          ${paidOn ? `<dt>Paid</dt><dd>${escapeHtml(paidOn)}</dd>` : ''}
          ${period ? `<dt>Period</dt><dd>${escapeHtml(period)}</dd>` : ''}
          <dt>Type</dt><dd>${escapeHtml(kindLabel)}</dd>
        </dl>
      </div>
    </section>
    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div class="item-name">${escapeHtml(description)}</div>
            ${orderHint ? `<div class="item-sub">${escapeHtml(orderHint)}</div>` : ''}
          </td>
          <td class="num">${escapeHtml(money(invoice.amount_cents))}</td>
        </tr>
      </tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${escapeHtml(money(invoice.amount_cents))}</td></tr>
      ${
        refundedCents > 0
          ? `<tr><td>Refunded</td><td class="num">−${escapeHtml(money(refundedCents))}</td></tr>`
          : ''
      }
      <tr class="grand">
        <td>${invoice.status === InvoiceStatus.PAID ? 'Total paid' : invoice.status === InvoiceStatus.CANCELLED ? 'Cancelled' : 'Amount due'}</td>
        <td class="num">${escapeHtml(
          money(
            invoice.status === InvoiceStatus.CANCELLED
              ? 0
              : Math.max(0, invoice.amount_cents - refundedCents),
          ),
        )}</td>
      </tr>
    </table>
    ${
      invoice.status === InvoiceStatus.PAID
        ? `<p class="note">${
            refundedCents > 0 && refundedCents >= chargedCents
              ? 'This invoice was paid and later refunded in full.'
              : `Paid in full${paidOn ? ` on ${escapeHtml(paidOn)}` : ''}. Thank you.`
          }</p>`
        : invoice.status === InvoiceStatus.AWAITING
          ? `<p class="note">Payment is due upon receipt. Pay by card from your client portal or the payment link we sent.</p>`
          : ''
    }
    ${
      paymentRows
        ? `<section class="pay">
        <div class="k">Payment record</div>
        <table>
          <thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      </section>`
        : ''
    }
    <footer class="foot">
      <div>
        <strong>Las Vegas Designs USA</strong>
        Embroidery digitizing, vector art, and custom design.
      </div>
      <div style="text-align:right">
        Questions about this invoice?<br/>
        Message us from your client portal.
      </div>
    </footer>
  </article>
  </div>
  <script>
    function go(){ window.print(); }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function(){ setTimeout(go, 60); });
    } else {
      window.addEventListener('load', go);
    }
  </script>
</body>
</html>`;
}
