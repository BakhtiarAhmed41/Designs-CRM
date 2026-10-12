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
  OrderPaymentStatus,
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
import { LocalStorageService } from '../storage/local-storage.service';
import { StripeService } from './stripe.service';
import { ThemeService } from '../settings/theme.service';
import { DEFAULT_THEME_COLORS, type ThemeColors } from '../settings/theme';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

function displayOrderNumber(ref?: string | null) {
  const digits = (ref ?? '').replace(/\D/g, '');
  return digits.length === 10 ? `#${digits}` : ref?.trim() || '';
}

function serviceLabel(serviceType?: string | null): string {
  const s = (serviceType ?? '').toLowerCase();
  if (!s) return 'Design service';
  if (s.includes('embroid')) return 'Embroidery Digitizing';
  if (s.includes('vector')) return 'Vector & Print Files';
  if (s.includes('svg') || s.includes('cnc') || s.includes('laser')) return 'CNC, Laser & 3D Files';
  return serviceType!
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseIdList(raw: unknown, fallback: string | null): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
      }
    } catch {
      /* stored as plain text */
    }
  }
  return fallback ? [fallback] : [];
}

function withCheckoutSession(path: string) {
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}session_id={CHECKOUT_SESSION_ID}`;
}

function clip(value: string | null | undefined, max: number) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type CheckoutItem = {
  name: string;
  size?: string | null;
  placement?: string | null;
  detail: string | null;
  amountCents: number | null;
};

type CheckoutGroup = {
  orderRef: string | null;
  orderName: string | null;
  serviceLabel: string;
  amountCents: number | null;
  items: CheckoutItem[];
};

export type CheckoutSummary = {
  title: string;
  kind: InvoiceKind;
  currency: string;
  amountDueCents: number;
  alreadyPaidCents: number;
  groups: CheckoutGroup[];
};

function sumCents(values: Array<number | null | undefined>) {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function amountsMatch(values: Array<number | null>, target: number) {
  return target > 0 && values.length > 0 && values.every((value) => value != null) && sumCents(values) === target;
}

function reconcileCheckoutGroups(groups: CheckoutGroup[], dueCents: number): CheckoutGroup[] {
  const groupAmounts = groups.map((group) => group.amountCents);
  const showGroupTotals = groups.length > 1 && amountsMatch(groupAmounts, dueCents);
  return groups.map((group) => {
    const target = groups.length === 1 ? dueCents : showGroupTotals ? group.amountCents : null;
    const showItemPrices =
      target != null && amountsMatch(group.items.map((item) => item.amountCents), target);
    return {
      ...group,
      amountCents: showGroupTotals ? group.amountCents : null,
      items: group.items.map((item) => ({
        ...item,
        amountCents: showItemPrices ? item.amountCents : null,
      })),
    };
  });
}

function stripeLineItems(summary: CheckoutSummary) {
  const fromItems = summary.groups.flatMap((group) =>
    group.items
      .filter((item) => (item.amountCents ?? 0) > 0)
      .map((item) => ({
        name: item.name,
        description: [group.serviceLabel, group.orderRef ? `Order ${group.orderRef}` : null, item.detail]
          .filter(Boolean)
          .join(' · '),
        amountCents: item.amountCents ?? 0,
      })),
  );
  if (sumCents(fromItems.map((item) => item.amountCents)) === summary.amountDueCents && fromItems.length) {
    return fromItems;
  }

  const fromGroups = summary.groups
    .filter((group) => (group.amountCents ?? 0) > 0)
    .map((group) => ({
      name: group.orderName || (group.orderRef ? `Order ${group.orderRef}` : summary.title),
      description: [
        group.serviceLabel,
        group.orderRef ? `Order ${group.orderRef}` : null,
        group.items.map((item) => item.name).filter(Boolean).join(', ') || null,
      ]
        .filter(Boolean)
        .join(' · '),
      amountCents: group.amountCents ?? 0,
    }));
  if (sumCents(fromGroups.map((item) => item.amountCents)) === summary.amountDueCents && fromGroups.length) {
    return fromGroups;
  }

  const description = summary.groups
    .map((group) =>
      [
        group.serviceLabel,
        group.orderRef ? `Order ${group.orderRef}` : group.orderName,
        group.items.map((item) => item.name).filter(Boolean).join(', ') || null,
      ]
        .filter(Boolean)
        .join(' · '),
    )
    .filter(Boolean)
    .join('; ');

  return [
    {
      name: summary.title || 'Design invoice',
      description,
      amountCents: summary.amountDueCents,
    },
  ];
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

/** The month that just ended - default for month-end statements. */
function previousPeriodMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function invoiceRemainingCents(inv: { amount_cents: number; amount_paid_cents?: number }) {
  return Math.max(0, inv.amount_cents - (inv.amount_paid_cents ?? 0));
}

function isOpenInvoiceStatus(status: InvoiceStatus) {
  return status === InvoiceStatus.AWAITING || status === InvoiceStatus.PARTIAL;
}

function netTermsDays(terms?: string | null) {
  if (terms === 'NET_15') return 15;
  if (terms === 'NET_30') return 30;
  return 30;
}

const INVOICE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

type UploadedImage = {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
};

function isInvoiceImage(file: { originalname: string; mimetype?: string }) {
  if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype ?? '')) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.originalname);
}

function imageContentType(mime: string | null | undefined, name: string | null | undefined) {
  if (mime && /^image\/(jpeg|png|webp|gif)$/i.test(mime)) return mime;
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
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
  amount_paid_cents: number;
  currency: string;
  covers_text: string | null;
  image_storage_key?: string | null;
  image_name?: string | null;
  image_mime?: string | null;
  status: InvoiceStatus;
  period_month: string | null;
  store_credit_applied_cents: number;
  issued_at: Date;
  due_at: Date | null;
  paid_at: Date | null;
};

type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  order_id: string | null;
  description: string;
  amount_cents: number;
  created_at: Date;
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
  net_terms?: 'NET_15' | 'NET_30' | null;
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
    private storage: LocalStorageService,
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

  private invoiceDto(
    i: InvoiceRow & {
      customer_name?: string | null;
      order_ref?: string | null;
      service_type?: string | null;
    },
  ) {
    return {
      id: i.id,
      customerId: i.customer_id,
      customerName: i.customer_name ?? null,
      orderId: i.order_id,
      orderRef: i.order_ref ?? null,
      serviceType: i.service_type ?? null,
      kind: i.kind,
      amountCents: i.amount_cents,
      amountPaidCents: i.amount_paid_cents ?? 0,
      remainingCents: invoiceRemainingCents(i),
      currency: i.currency,
      coversText: i.covers_text,
      imageName: i.image_name ?? null,
      status: i.status,
      periodMonth: i.period_month,
      storeCreditAppliedCents: i.store_credit_applied_cents,
      issuedAt: i.issued_at,
      dueAt: i.due_at ?? null,
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
      'SELECT id, user_id, name, email, account_type, net_terms, store_credit_cents FROM customers WHERE id = ? LIMIT 1',
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
      OrderStatus.CLOSED,
      opts.periodMonth,
      InvoiceStatus.AWAITING,
      InvoiceStatus.PARTIAL,
      InvoiceStatus.PAID,
    ];
    const customerClause = opts.customerId ? 'AND o.customer_id = ?' : '';
    if (opts.customerId) params.push(opts.customerId);

    const row = await this.db.queryOne<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(o.price_cents), 0) AS total
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE c.account_type = ?
          AND o.status IN (?, ?)
          AND o.price_cents IS NOT NULL
          AND DATE_FORMAT(COALESCE(o.completed_at, o.closed_at), '%Y-%m') = ?
          AND o.id NOT IN (
                SELECT order_id FROM invoices
                 WHERE order_id IS NOT NULL
                   AND status IN (?, ?, ?)
              )
          AND o.id NOT IN (
                SELECT order_id FROM invoice_lines WHERE order_id IS NOT NULL
              )
          ${customerClause}`,
      params,
    );
    return Number(row?.total ?? 0);
  }

  private async invoiceFullyRefunded(invoice: InvoiceRow): Promise<boolean> {
    const row = await this.db.queryOne<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM payments
        WHERE invoice_id = ?
          AND type = ?
          AND status = ?`,
      [invoice.id, PaymentType.REFUND, PaymentStatus.PAID],
    );
    return Number(row?.total ?? 0) >= invoice.amount_cents;
  }

  /**
   * Payment state for one order.
   * Monthly customers stay Unpaid until a paid monthly statement exists
   * for the month they completed in (and they were not billed separately).
   */
  async resolveOrderPaymentStatus(order: {
    id: string;
    customer_id: string | null;
    status: OrderStatus;
    completed_at: Date | string | null;
  }): Promise<OrderPaymentStatus> {
    if (order.status === OrderStatus.REFUNDED) return OrderPaymentStatus.REFUNDED;

    const perOrder = await this.db.queryOne<InvoiceRow>(
      `SELECT * FROM invoices
        WHERE order_id = ?
          AND kind = ?
          AND status IN (?, ?, ?)
        ORDER BY issued_at DESC
        LIMIT 1`,
      [
        order.id,
        InvoiceKind.PER_ORDER,
        InvoiceStatus.AWAITING,
        InvoiceStatus.PARTIAL,
        InvoiceStatus.PAID,
      ],
    );
    if (perOrder) {
      if (await this.invoiceFullyRefunded(perOrder)) {
        return OrderPaymentStatus.REFUNDED;
      }
      if (perOrder.status === InvoiceStatus.PAID) return OrderPaymentStatus.PAID;
      return OrderPaymentStatus.AWAITING;
    }

    const monthlyLine = await this.db.queryOne<InvoiceRow>(
      `SELECT i.*
         FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
        WHERE l.order_id = ?
          AND i.status <> ?
        ORDER BY i.issued_at DESC
        LIMIT 1`,
      [order.id, InvoiceStatus.CANCELLED],
    );
    if (monthlyLine) {
      if (await this.invoiceFullyRefunded(monthlyLine)) {
        return OrderPaymentStatus.REFUNDED;
      }
      if (monthlyLine.status === InvoiceStatus.PAID) return OrderPaymentStatus.PAID;
      return OrderPaymentStatus.AWAITING;
    }

    if (
      order.customer_id &&
      (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.CLOSED)
    ) {
      const billedSeparately = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM invoices
          WHERE order_id = ?
            AND status IN (?, ?, ?)
          LIMIT 1`,
        [
          order.id,
          InvoiceStatus.AWAITING,
          InvoiceStatus.PARTIAL,
          InvoiceStatus.PAID,
        ],
      );
      if (!billedSeparately) {
        const customer = await this.getCustomerRow(order.customer_id);
        if (customer?.account_type === AccountType.NET_MONTHLY) {
          return OrderPaymentStatus.UNPAID;
        }
      }
    }

    if (order.status === OrderStatus.PENDING_PAYMENT) {
      return OrderPaymentStatus.AWAITING;
    }
    return OrderPaymentStatus.UNPAID;
  }

  private async resolveMyCustomer(
    user: AuthUser | undefined,
  ): Promise<CustomerRow> {
    assertAuthUser(user);
    const row = await this.db.queryOne<CustomerRow>(
      'SELECT id, user_id, name, email, account_type, net_terms, store_credit_cents FROM customers WHERE user_id = ? LIMIT 1',
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
    if (filters.status === InvoiceStatus.AWAITING) {
      where.push('i.status IN (?, ?)');
      params.push(InvoiceStatus.AWAITING, InvoiceStatus.PARTIAL);
    } else if (filters.status && statuses.includes(filters.status)) {
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
    return Promise.all(rows.map((r) => this.presentInvoice(r)));
  }

  private async presentInvoice(
    row: InvoiceRow & {
      customer_name?: string | null;
      order_ref?: string | null;
      service_type?: string | null;
    },
  ) {
    const dto = this.invoiceDto(row);
    if (!row.image_storage_key) return { ...dto, imageUrl: null as string | null };
    const imageUrl = await this.storage.createSignedUrl({
      key: row.image_storage_key,
      downloadAs: row.image_name || 'invoice-image',
      inline: true,
    });
    return { ...dto, imageUrl };
  }

  private async attachInvoiceImage(invoiceId: string, file: UploadedImage) {
    if (!isInvoiceImage(file)) {
      throw new BadRequestException('Attach a PNG, JPG, WEBP, or GIF image');
    }
    const bytes = file.size || file.buffer.length;
    if (!file.buffer?.length || bytes <= 0) {
      throw new BadRequestException('Image file is empty');
    }
    if (bytes > INVOICE_IMAGE_MAX_BYTES) {
      throw new BadRequestException('Image must be 8MB or smaller');
    }
    const previous = await this.getInvoiceRow(invoiceId);
    const key = this.storage.newObjectKey(['invoices', invoiceId], file.originalname || 'image');
    await this.storage.uploadObject({
      key,
      body: file.buffer,
      contentType: imageContentType(file.mimetype, file.originalname),
    });
    await this.db.execute(
      'UPDATE invoices SET image_storage_key = ?, image_name = ?, image_mime = ? WHERE id = ?',
      [
        key,
        (file.originalname || 'image').slice(0, 255),
        imageContentType(file.mimetype, file.originalname).slice(0, 120),
        invoiceId,
      ],
    );
    if (previous?.image_storage_key && previous.image_storage_key !== key) {
      await this.storage.deleteObject(previous.image_storage_key);
    }
  }

  private invoiceImageDataUri(invoice: InvoiceRow) {
    if (!invoice.image_storage_key) return '';
    try {
      const path = this.storage.resolveExisting(invoice.image_storage_key);
      const buf = readFileSync(path);
      const type = imageContentType(invoice.image_mime, invoice.image_name);
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return '';
    }
  }

  async createInvoice(
    user: AuthUser | undefined,
    data: {
      customerId: string;
      orderId?: string | null;
      amountCents: number;
      coversText?: string | null;
    },
    image?: UploadedImage,
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
        if (image) await this.attachInvoiceImage(existing.id, image);
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

    try {
      if (image) await this.attachInvoiceImage(id, image);
    } catch (err) {
      await this.db.execute('DELETE FROM invoices WHERE id = ?', [id]);
      throw err;
    }

    await this.notifyCustomerUser(data.customerId, {
      title: 'New invoice',
      body: `An invoice for your account is awaiting payment.`,
      link: '/portal/invoices',
    });

    return this.getInvoiceDetail(user, id);
  }

  /**
   * After a customer accepts a quote: create a per-order invoice + pay link.
   * No admin check - the customer already owns the order.
   */
  async billPayPerOrderQuote(data: {
    customerId: string;
    orderId: string;
    amountCents: number;
    coversText?: string | null;
    notify?: boolean;
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
      if (data.notify !== false) {
        await this.notifyCustomerUser(data.customerId, {
          title: 'Invoice ready',
          body: 'Your quote was accepted. Please pay to start the order.',
          link: `/portal/orders/${data.orderId}`,
        });
      }
    }

    if (invoice && invoice.status === InvoiceStatus.AWAITING) {
      await this.ensurePendingPayLink(invoice);
    }
  }

  /** Paid revision bill. Does not require an admin session. */
  async createRevisionInvoice(data: {
    customerId: string;
    orderId: string;
    amountCents: number;
    coversText: string;
  }) {
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
      title: 'Revision payment',
      body: data.coversText.trim(),
      link: `/portal/orders/${data.orderId}`,
    });
    return { id };
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
    const ref = displayOrderNumber(req.human_ref) || req.order_name || req.order_id.slice(0, 6);
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
        WHERE order_id = ? AND kind = ? AND status IN (?, ?)
        ORDER BY issued_at ASC
        LIMIT 1`,
      [orderId, InvoiceKind.PER_ORDER, InvoiceStatus.AWAITING, InvoiceStatus.PARTIAL],
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
    const lines = await this.db.query<InvoiceLineRow>(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY created_at ASC',
      [id],
    );
    const customer = await this.getCustomerRow(invoice.customer_id);
    return {
      ...(await this.presentInvoice(invoice)),
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
      lines: lines.map((l) => this.invoiceLineDto(l)),
    };
  }

  private invoiceLineDto(l: InvoiceLineRow) {
    return {
      id: l.id,
      invoiceId: l.invoice_id,
      orderId: l.order_id,
      description: l.description,
      amountCents: l.amount_cents,
      createdAt: l.created_at,
    };
  }

  async cancelInvoice(user: AuthUser | undefined, invoiceId: string) {
    this.assertAdmin(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!isOpenInvoiceStatus(invoice.status) || invoiceRemainingCents(invoice) < invoice.amount_cents) {
      throw new BadRequestException('Only unpaid invoices with no payments can be cancelled');
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
    if (!isOpenInvoiceStatus(invoice.status)) {
      throw new BadRequestException('Only unpaid invoices can be reminded');
    }

    const payLink = await this.createPayLink(user, invoiceId);
    await this.notifyCustomerUser(invoice.customer_id, {
      title: 'Payment reminder',
      body: `Your invoice for ${invoice.covers_text ?? 'your order'} is still awaiting payment.`,
      link: payLink.url,
    });
    const customer = await this.getCustomerRow(invoice.customer_id);
    if (customer?.email) {
      const amountLabel = `${(invoiceRemainingCents(invoice) / 100).toFixed(2)} ${invoice.currency}`;
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

  private invoiceSettleStatus(amountCents: number, amountPaidCents: number): InvoiceStatus {
    if (amountPaidCents >= amountCents) return InvoiceStatus.PAID;
    if (amountPaidCents > 0) return InvoiceStatus.PARTIAL;
    return InvoiceStatus.AWAITING;
  }

  private async settleInvoicePayment(
    tx: DbTransaction,
    invoiceId: string,
    applyCents: number,
    extras?: { storeCreditAppliedCents?: number },
  ) {
    const locked = await tx.queryOne<InvoiceRow>(
      'SELECT * FROM invoices WHERE id = ? LIMIT 1 FOR UPDATE',
      [invoiceId],
    );
    if (!locked) throw new NotFoundException('Invoice not found');
    if (locked.status === InvoiceStatus.PAID) return { applied: 0, status: InvoiceStatus.PAID };
    if (locked.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay a cancelled invoice');
    }
    if (!isOpenInvoiceStatus(locked.status)) {
      throw new BadRequestException('Invoice is not awaiting payment');
    }
    const remaining = invoiceRemainingCents(locked);
    const applied = Math.min(remaining, applyCents);
    if (applied <= 0) return { applied: 0, status: locked.status };
    const amountPaid = (locked.amount_paid_cents ?? 0) + applied;
    const status = this.invoiceSettleStatus(locked.amount_cents, amountPaid);
    await tx.execute(
      `UPDATE invoices
          SET amount_paid_cents = ?,
              status = ?,
              paid_at = IF(? = ?, NOW(), paid_at),
              store_credit_applied_cents = store_credit_applied_cents + ?
        WHERE id = ?`,
      [
        amountPaid,
        status,
        status,
        InvoiceStatus.PAID,
        extras?.storeCreditAppliedCents ?? 0,
        invoiceId,
      ],
    );
    return { applied, status };
  }

  private async afterInvoicePayment(invoiceId: string) {
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) return;
    if (invoice.status === InvoiceStatus.PAID) {
      await this.advanceOrderAfterPayment(invoice.order_id);
      await this.releasePaidFormatExport(invoice.id);
      await this.notifyCustomerUser(invoice.customer_id, {
        title: 'Payment received',
        body: `We received your payment for ${invoice.covers_text ?? 'your invoice'}.`,
        link: '/portal/invoices',
      });
      return;
    }
    if (invoice.status === InvoiceStatus.PARTIAL) {
      await this.notifyCustomerUser(invoice.customer_id, {
        title: 'Partial payment received',
        body: `A payment was applied. ${(invoiceRemainingCents(invoice) / 100).toFixed(2)} ${invoice.currency} remains on ${invoice.covers_text ?? 'your invoice'}.`,
        link: '/portal/invoices',
      });
    }
  }

  private async payInvoiceInternal(
    invoice: InvoiceRow,
    method: 'CARD' | 'STORE_CREDIT',
    amountCents?: number,
  ) {
    if (invoice.status === InvoiceStatus.PAID) {
      return;
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay a cancelled invoice');
    }
    if (!isOpenInvoiceStatus(invoice.status)) {
      throw new BadRequestException('Invoice is not awaiting payment');
    }

    const remaining = invoiceRemainingCents(invoice);
    if (remaining <= 0) return;
    if (amountCents != null && (!Number.isInteger(amountCents) || amountCents <= 0)) {
      throw new BadRequestException('amountCents must be a positive integer');
    }
    if (amountCents != null && amountCents > remaining) {
      throw new BadRequestException('Payment exceeds the remaining balance');
    }

    if (method === PaymentMethod.STORE_CREDIT) {
      await this.db.withTransaction(async (tx) => {
        const customer = await tx.queryOne<{ store_credit_cents: number }>(
          'SELECT store_credit_cents FROM customers WHERE id = ? LIMIT 1 FOR UPDATE',
          [invoice.customer_id],
        );
        if (!customer) throw new NotFoundException('Customer not found');
        if (customer.store_credit_cents <= 0) {
          throw new BadRequestException('Insufficient store credit');
        }
        const apply = Math.min(
          remaining,
          customer.store_credit_cents,
          amountCents ?? remaining,
        );
        if (apply <= 0) throw new BadRequestException('Nothing to apply');

        const settled = await this.settleInvoicePayment(tx, invoice.id, apply, {
          storeCreditAppliedCents: apply,
        });
        if (settled.applied <= 0) return;

        await tx.execute(
          'UPDATE customers SET store_credit_cents = store_credit_cents - ? WHERE id = ?',
          [settled.applied, invoice.customer_id],
        );
        await tx.execute(
          'INSERT INTO store_credit_entries (id, customer_id, delta_cents, reason) VALUES (?, ?, ?, ?)',
          [
            randomUUID(),
            invoice.customer_id,
            -settled.applied,
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
            settled.applied,
            invoice.currency,
            PaymentMethod.STORE_CREDIT,
            PaymentType.CHARGE,
            PaymentStatus.PAID,
          ],
        );
      });
    } else {
      await this.db.withTransaction(async (tx) => {
        const settled = await this.settleInvoicePayment(
          tx,
          invoice.id,
          amountCents ?? remaining,
        );
        if (settled.applied <= 0) return;
        await tx.execute(
          `INSERT INTO payments
             (id, invoice_id, order_id, customer_id, amount_cents, currency, method, type, status, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            randomUUID(),
            invoice.id,
            invoice.order_id,
            invoice.customer_id,
            settled.applied,
            invoice.currency,
            PaymentMethod.CARD,
            PaymentType.CHARGE,
            PaymentStatus.PAID,
          ],
        );
      });
    }

    await this.afterInvoicePayment(invoice.id);
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
    amountCents?: number,
  ) {
    this.assertAdmin(user);
    const invoice = await this.getInvoiceRow(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const m = this.parsePayMethod(method);
    await this.payInvoiceInternal(invoice, m, amountCents);
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
    if (!isOpenInvoiceStatus(invoice.status))
      throw new BadRequestException('Invoice is not awaiting payment');

    const payment = await this.ensurePendingPayLink(invoice);
    return { token: payment.pay_link_token!, url: `/pay/${payment.pay_link_token}` };
  }

  private async ensurePendingPayLink(invoice: InvoiceRow): Promise<PaymentRow> {
    const remaining = invoiceRemainingCents(invoice);
    const existing = await this.db.queryOne<PaymentRow>(
      `SELECT * FROM payments
        WHERE invoice_id = ? AND method = ? AND status = ? AND pay_link_token IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [invoice.id, PaymentMethod.LINK, PaymentStatus.PENDING],
    );
    if (existing?.pay_link_token) {
      if (existing.amount_cents !== remaining) {
        await this.db.execute('UPDATE payments SET amount_cents = ? WHERE id = ?', [
          remaining,
          existing.id,
        ]);
        existing.amount_cents = remaining;
      }
      return existing;
    }

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
        remaining,
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
      amountCents: invoiceRemainingCents(invoice),
      amountPaidCents: invoice.amount_paid_cents ?? 0,
      remainingCents: invoiceRemainingCents(invoice),
      currency: invoice.currency,
      customerName: invoice.customer_name ?? null,
      coversText: invoice.covers_text,
      status: invoice.status,
      dueAt: invoice.due_at ?? null,
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
      successPath: `/pay/${token}?status=return`,
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

  private async checkoutItemsForOrder(orderId: string): Promise<CheckoutItem[]> {
    const order = await this.db.queryOne<{ name: string | null; preferences: unknown }>(
      'SELECT name, preferences FROM orders WHERE id = ? LIMIT 1', [orderId],
    );
    const preferences = order?.preferences && typeof order.preferences === 'object'
      ? order.preferences as { designs?: Array<{ name?: string; sizes?: Array<{ detail?: string; label?: string; placement?: string; w?: string; h?: string; unit?: string }> }> }
      : null;
    const designTitle = (name: string) => name.replace(/^Design\s+\d+\s*[-–—·:]\s*/i, '').trim();
    const quoted = await this.db.query<{
      id: string;
      name: string;
      note: string | null;
      price_cents: number | null;
      size_label: string | null;
      size_price: number | null;
      size_sort: number | null;
    }>(
      `SELECT ql.id, ql.name, ql.note, ql.price_cents,
              qs.label AS size_label, qs.price_cents AS size_price, qs.sort_order AS size_sort
         FROM quotation_lines ql
         JOIN quotations q ON q.id = ql.quotation_id
         LEFT JOIN quotation_line_sizes qs ON qs.line_id = ql.id
        WHERE q.order_id = ?
          AND q.status = 'APPROVED'
          AND ql.client_decision <> 'DROPPED'
          AND q.id = (
            SELECT id FROM quotations
             WHERE order_id = ? AND status = 'APPROVED'
             ORDER BY version DESC LIMIT 1
          )
        ORDER BY ql.sort_order ASC, qs.sort_order ASC`,
      [orderId, orderId],
    );
    if (quoted.length > 0) {
      const lines = new Map<string, CheckoutItem & { sizePrices: number; note: string | null }>();
      for (const row of quoted) {
        const current = lines.get(row.id) ?? {
          name: row.name?.trim() || 'Design',
          detail: null,
          amountCents: row.price_cents ?? 0,
          sizePrices: 0,
          note: row.note,
        };
        if (row.size_label) {
          current.detail = current.detail ? `${current.detail}, ${row.size_label}` : row.size_label;
          current.sizePrices += row.size_price ?? 0;
        }
        lines.set(row.id, current);
      }
      return [...lines.values()].map((line) => {
        const label = line.note?.startsWith('design:') ? designTitle(line.note.slice(7)) : null;
        const design = preferences?.designs?.find((item) => designTitle(item.name || '') === label);
        const requestedSize = design?.sizes?.find((size) => [size.detail, size.label].some((value) => value?.trim().toLowerCase() === line.name.toLowerCase()))
          ?? (design?.sizes?.length === 1 ? design.sizes[0] : null);
        const dimensions = requestedSize?.w || requestedSize?.h
          ? [requestedSize.w, requestedSize.h].filter(Boolean).join(' × ') + ' ' + (requestedSize.unit === 'cm' ? 'cm' : requestedSize.unit === 'mm' ? 'mm' : 'inch')
          : null;
        const size = requestedSize?.detail || dimensions || line.detail || (label ? line.name : null);
        return {
          name: label || line.name,
          size,
          placement: requestedSize?.placement || null,
          detail: [size, requestedSize?.placement].filter(Boolean).join(' · ') || (line.note?.startsWith('design:') ? null : clip(line.note, 160)),
          amountCents: (line.amountCents ?? 0) + line.sizePrices,
        };
      });
    }

    const designs = await this.db.query<{
      name: string;
      placement: string | null;
      size: string | null;
      price_cents: number | null;
    }>(
      `SELECT name, placement, size, price_cents
         FROM order_designs
        WHERE order_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
      [orderId],
    );
    return designs.map((design) => ({
      name: design.name?.trim() || 'Design',
      size: design.size,
      placement: design.placement,
      detail: [design.placement, design.size].map((part) => part?.trim()).filter(Boolean).join(' · ') || null,
      amountCents: design.price_cents,
    }));
  }

  private async revisionItems(invoiceId: string): Promise<CheckoutItem[]> {
    const edit = await this.db.queryOne<{
      design_id: string | null;
      design_ids: unknown;
      note: string | null;
    }>(
      'SELECT design_id, design_ids, note FROM edit_requests WHERE invoice_id = ? LIMIT 1',
      [invoiceId],
    );
    if (!edit) return [];
    const ids = parseIdList(edit.design_ids, edit.design_id);
    if (ids.length === 0) {
      return [
        {
          name: 'Revision',
          detail: clip(edit.note, 180),
          amountCents: null,
        },
      ];
    }
    const designs = await this.db.query<{ id: string; name: string; placement: string | null; size: string | null }>(
      `SELECT id, name, placement, size FROM order_designs WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    const byId = new Map(designs.map((design) => [design.id, design]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((design): design is NonNullable<typeof design> => Boolean(design))
      .map((design) => ({
        name: design.name?.trim() || 'Design',
        detail: [design.placement, design.size].map((part) => part?.trim()).filter(Boolean).join(' · ') || null,
        amountCents: null,
      }));
    return items.length
      ? items
      : [{ name: 'Revision', detail: clip(edit.note, 180), amountCents: null }];
  }

  private async buildCheckoutSummary(invoice: InvoiceRow, displayAmount = invoiceRemainingCents(invoice)): Promise<CheckoutSummary> {
    const due = displayAmount;
    const lines =
      invoice.kind === InvoiceKind.MONTHLY
        ? await this.db.query<InvoiceLineRow>(
            'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY created_at ASC',
            [invoice.id],
          )
        : [];
    const orderIds = new Set<string>();
    if (invoice.order_id) orderIds.add(invoice.order_id);
    for (const line of lines) {
      if (line.order_id) orderIds.add(line.order_id);
    }
    const orders = orderIds.size
      ? await this.db.query<{
          id: string;
          human_ref: string | null;
          name: string | null;
          service_type: string | null;
        }>(
          `SELECT id, human_ref, name, service_type FROM orders WHERE id IN (${[...orderIds].map(() => '?').join(',')})`,
          [...orderIds],
        )
      : [];
    const byId = new Map(orders.map((order) => [order.id, order]));

    const groupForOrder = async (
      orderId: string | null,
      fallbackName: string,
      amountCents: number | null,
      items?: CheckoutItem[],
    ): Promise<CheckoutGroup> => {
      const order = orderId ? byId.get(orderId) : undefined;
      const resolved =
        items ??
        (orderId ? await this.checkoutItemsForOrder(orderId) : []);
      const list = resolved.length
        ? resolved
        : [{ name: fallbackName, detail: null, amountCents }];
      return {
        orderRef: displayOrderNumber(order?.human_ref) || null,
        orderName: order?.name?.trim() || null,
        serviceLabel: serviceLabel(order?.service_type),
        amountCents,
        items: list,
      };
    };

    let groups: CheckoutGroup[] = [];
    if (invoice.kind === InvoiceKind.MONTHLY && lines.length > 0) {
      groups = await Promise.all(
        lines.map((line) =>
          groupForOrder(line.order_id, line.description, line.amount_cents),
        ),
      );
    } else if (invoice.kind === InvoiceKind.ADD_ON) {
      const revision = await this.revisionItems(invoice.id);
      groups = [
        await groupForOrder(
          invoice.order_id,
          invoice.covers_text?.trim() || 'Revision',
          due,
          revision.length ? revision : undefined,
        ),
      ];
    } else if (invoice.order_id) {
      groups = [
        await groupForOrder(invoice.order_id, invoice.covers_text?.trim() || 'Design', due),
      ];
    }

    if (groups.length === 0) {
      groups = [
        {
          orderRef: null,
          orderName: null,
          serviceLabel: 'Design service',
          amountCents: due,
          items: [
            {
              name: invoice.covers_text?.trim() || 'Design invoice',
              detail: null,
              amountCents: due,
            },
          ],
        },
      ];
    }

    const title =
      invoice.covers_text?.trim() ||
      groups.find((group) => group.orderName)?.orderName ||
      (groups[0]?.orderRef ? `Order ${groups[0].orderRef}` : 'Design invoice');

    return {
      title,
      kind: invoice.kind,
      currency: invoice.currency,
      amountDueCents: due,
      alreadyPaidCents: invoice.amount_paid_cents ?? 0,
      groups: reconcileCheckoutGroups(groups, due),
    };
  }

  private async startStripeCheckout(
    invoice: InvoiceRow,
    payment: PaymentRow,
    dest: { successPath: string; web: string },
  ) {
    if (invoice.status === InvoiceStatus.PAID) {
      return { alreadyPaid: true as const };
    }
    if (!isOpenInvoiceStatus(invoice.status)) {
      throw new BadRequestException('Invoice is not awaiting payment');
    }
    if (!this.stripe.isConfigured()) {
      throw new BadRequestException('Card checkout is not configured');
    }
    const remaining = invoiceRemainingCents(invoice);
    if (remaining <= 0) {
      return { alreadyPaid: true as const };
    }
    const customer = await this.getCustomerRow(invoice.customer_id);
    const emailOnFile = Boolean(customer?.email?.trim());
    if (payment.stripe_checkout_session_id) {
      try {
        const paidSession = await this.loadPaidStripeSession(
          payment.stripe_checkout_session_id,
        );
        if (paidSession) {
          await this.fulfillStripeSession(paidSession);
          return { alreadyPaid: true as const };
        }
        const existing = await this.stripe.retrieveSession(
          payment.stripe_checkout_session_id,
        );
        if (
          existing.status === 'open' &&
          existing.ui_mode === 'elements' &&
          existing.client_secret &&
          existing.amount_total === remaining
        ) {
          return {
            clientSecret: existing.client_secret,
            sessionId: existing.id,
            publishableKey: getEnv().STRIPE_PUBLISHABLE_KEY.trim(),
            emailOnFile,
            summary: await this.buildCheckoutSummary(invoice),
          };
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
      }
    }

    const summary = await this.buildCheckoutSummary(invoice);
    const returnUrl = `${dest.web}${withCheckoutSession(dest.successPath)}`;
    const session = await this.stripe.createInvoiceCheckout({
      currency: invoice.currency,
      returnUrl,
      invoiceId: invoice.id,
      paymentId: payment.id,
      customerEmail: customer?.email,
      lineItems: stripeLineItems(summary),
    });
    await this.db.execute(
      'UPDATE payments SET stripe_checkout_session_id = ? WHERE id = ?',
      [session.id, payment.id],
    );
    return {
      clientSecret: session.client_secret!,
      sessionId: session.id,
      publishableKey: getEnv().STRIPE_PUBLISHABLE_KEY.trim(),
      emailOnFile,
      summary,
    };
  }

  private stripeSessionIsPaid(session: {
    payment_status?: string | null;
    payment_intent?: string | { id?: string; status?: string } | null;
  }): boolean {
    if (session.payment_status === 'paid') return true;
    const intent = session.payment_intent;
    return Boolean(
      intent && typeof intent === 'object' && intent.status === 'succeeded',
    );
  }

  private async loadPaidStripeSession(sessionId: string) {
    if (!this.stripe.isConfigured()) return null;
    const session = await this.stripe.retrieveSession(sessionId, {
      expandPaymentIntent: true,
    });
    return this.stripeSessionIsPaid(session) ? session : null;
  }

  private async confirmStripePayment(payment: PaymentRow) {
    if (!payment.stripe_checkout_session_id || !this.stripe.isConfigured()) {
      return;
    }
    const session = await this.loadPaidStripeSession(
      payment.stripe_checkout_session_id,
    );
    if (session) await this.fulfillStripeSession(session);
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const event = this.stripe.constructWebhookEvent(rawBody, signature);
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const sessionId = (event.data.object as { id?: string }).id;
      if (!sessionId) return;
      const paid = await this.loadPaidStripeSession(sessionId);
      if (!paid) return;
      await this.fulfillStripeSession(paid);
    }
  }

  private async fulfillStripeSession(session: {
    id: string;
    payment_status?: string | null;
    amount_total?: number | null;
    payment_intent?: string | { id: string; status?: string } | null;
    metadata?: Record<string, string> | null;
    client_reference_id?: string | null;
  }) {
    if (!this.stripeSessionIsPaid(session)) return;
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

    const remaining = invoiceRemainingCents(invoice);
    const chargeCents = Math.max(
      0,
      Math.min(
        remaining,
        session.amount_total ?? payment?.amount_cents ?? remaining,
      ),
    );
    if (chargeCents <= 0) return;

    await this.db.withTransaction(async (tx) => {
      const locked = await tx.queryOne<InvoiceRow>(
        'SELECT * FROM invoices WHERE id = ? LIMIT 1 FOR UPDATE',
        [invoice.id],
      );
      if (!locked || locked.status === InvoiceStatus.PAID) return;
      if (!isOpenInvoiceStatus(locked.status)) return;

      if (payment) {
        await tx.execute(
          `UPDATE payments
              SET status = ?, method = ?, paid_at = NOW(), amount_cents = ?,
                  stripe_checkout_session_id = ?,
                  stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id)
            WHERE id = ?`,
          [
            PaymentStatus.PAID,
            PaymentMethod.CARD,
            chargeCents,
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
            chargeCents,
            invoice.currency,
            PaymentMethod.CARD,
            PaymentType.CHARGE,
            PaymentStatus.PAID,
            session.id,
            intentId,
          ],
        );
      }
      const settled = await this.settleInvoicePayment(tx, invoice.id, chargeCents);
      const leftover = Math.max(0, locked.amount_cents - ((locked.amount_paid_cents ?? 0) + settled.applied));
      if (settled.status === InvoiceStatus.PAID) {
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
      } else {
        await tx.execute(
          `UPDATE payments SET amount_cents = ?
            WHERE invoice_id = ? AND status = ?`,
          [leftover, invoice.id, PaymentStatus.PENDING],
        );
      }
    });

    await this.afterInvoicePayment(invoice.id);
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
      web,
    });
  }

  async startCheckoutForMyOrder(
    user: AuthUser | undefined,
    orderId: string,
    opts?: { returnOrigin?: string; returnPath?: string },
  ) {
    const customer = await this.resolveMyCustomer(user);
    const invoice = await this.db.queryOne<InvoiceRow>(
      `SELECT * FROM invoices
        WHERE order_id = ? AND customer_id = ? AND status IN (?, ?)
        ORDER BY issued_at DESC LIMIT 1`,
      [orderId, customer.id, InvoiceStatus.AWAITING, InvoiceStatus.PARTIAL],
    );
    if (!invoice) {
      const paid = await this.db.queryOne<InvoiceRow>(
        `SELECT * FROM invoices
          WHERE order_id = ? AND customer_id = ? AND status = ?
          ORDER BY issued_at DESC LIMIT 1`,
        [orderId, customer.id, InvoiceStatus.PAID],
      );
      if (paid) return { alreadyPaid: true as const };
      throw new NotFoundException('No unpaid invoice for this order');
    }
    return this.startCheckoutForMyInvoice(user, invoice.id, {
      returnOrigin: opts?.returnOrigin,
      returnPath: opts?.returnPath ?? `/portal/orders/${orderId}`,
    });
  }

  async confirmMyOrder(user: AuthUser | undefined, orderId: string) {
    const customer = await this.resolveMyCustomer(user);
    const invoices = await this.db.query<InvoiceRow>(
      `SELECT * FROM invoices
        WHERE order_id = ? AND customer_id = ? AND status <> ?
        ORDER BY issued_at DESC`,
      [orderId, customer.id, InvoiceStatus.CANCELLED],
    );
    let last: { invoice: ReturnType<BillingService['invoiceDto']> | null } = {
      invoice: null,
    };
    for (const invoice of invoices) {
      last = await this.confirmMyInvoice(user, invoice.id);
    }
    return last;
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
    return { invoice: updated ? await this.presentInvoice(updated) : null };
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

  private async listUnbilledMonthlyOrders(customerId: string, periodMonth: string) {
    return this.db.query<{
      id: string;
      name: string | null;
      human_ref: string | null;
      price_cents: number;
      currency: string | null;
    }>(
      `SELECT o.id, o.name, o.human_ref, o.price_cents, o.currency
         FROM orders o
        WHERE o.customer_id = ?
          AND o.status IN (?, ?)
          AND o.price_cents IS NOT NULL
          AND o.price_cents > 0
          AND DATE_FORMAT(COALESCE(o.completed_at, o.closed_at), '%Y-%m') = ?
          AND o.id NOT IN (
                SELECT order_id FROM invoice_lines WHERE order_id IS NOT NULL
              )
          AND o.id NOT IN (
                SELECT order_id FROM invoices
                 WHERE order_id IS NOT NULL
                   AND status IN (?, ?, ?)
              )
        ORDER BY COALESCE(o.completed_at, o.closed_at) ASC`,
      [
        customerId,
        OrderStatus.COMPLETED,
        OrderStatus.CLOSED,
        periodMonth,
        InvoiceStatus.AWAITING,
        InvoiceStatus.PARTIAL,
        InvoiceStatus.PAID,
      ],
    );
  }

  private async insertInvoiceLines(
    invoiceId: string,
    orders: Array<{
      id: string;
      name: string | null;
      human_ref: string | null;
      price_cents: number;
    }>,
  ) {
    for (const o of orders) {
      const desc =
        [displayOrderNumber(o.human_ref), o.name].filter(Boolean).join(' · ') || 'Design order';
      await this.db.execute(
        `INSERT INTO invoice_lines (id, invoice_id, order_id, description, amount_cents)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), invoiceId, o.id, desc.slice(0, 255), o.price_cents],
      );
    }
  }

  async runMonthEnd(
    user: AuthUser | undefined,
    body: { periodMonth?: string },
  ) {
    this.assertAdmin(user);
    const period =
      body.periodMonth && isValidPeriodMonth(body.periodMonth)
        ? body.periodMonth
        : previousPeriodMonth();

    const customers = await this.db.query<CustomerRow>(
      'SELECT id, user_id, name, email, account_type, net_terms, store_credit_cents FROM customers WHERE account_type = ?',
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
      const orders = await this.listUnbilledMonthlyOrders(customer.id, period);
      if (orders.length === 0) continue;

      const addCents = orders.reduce((sum, o) => sum + o.price_cents, 0);
      if (addCents <= 0) continue;

      const open = await this.db.queryOne<InvoiceRow>(
        `SELECT * FROM invoices
          WHERE customer_id = ?
            AND kind = ?
            AND period_month = ?
            AND status IN (?, ?)
          ORDER BY issued_at ASC
          LIMIT 1`,
        [
          customer.id,
          InvoiceKind.MONTHLY,
          period,
          InvoiceStatus.AWAITING,
          InvoiceStatus.PARTIAL,
        ],
      );

      if (open) {
        await this.insertInvoiceLines(open.id, orders);
        const lineCount = await this.db.queryOne<{ n: number | string }>(
          'SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?',
          [open.id],
        );
        const totalCount = Number(lineCount?.n ?? orders.length);
        const coversText = `${totalCount} order${totalCount === 1 ? '' : 's'} in ${monthLabel(period)}`;
        await this.db.execute(
          'UPDATE invoices SET amount_cents = amount_cents + ?, covers_text = ? WHERE id = ?',
          [addCents, coversText, open.id],
        );
        await this.notifyCustomerUser(customer.id, {
          title: 'Monthly statement updated',
          body: coversText,
          link: '/portal/invoices',
        });
        summary.push({
          customerId: customer.id,
          customerName: customer.name,
          amountCents: open.amount_cents + addCents,
          orderCount: orders.length,
          invoiceId: open.id,
        });
        continue;
      }

      const invoiceId = randomUUID();
      const coversText = `${orders.length} order${orders.length === 1 ? '' : 's'} in ${monthLabel(period)}`;
      const dueDays = netTermsDays(customer.net_terms);
      await this.db.execute(
        `INSERT INTO invoices
           (id, customer_id, order_id, kind, amount_cents, amount_paid_cents, currency, covers_text, status, period_month, due_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [
          invoiceId,
          customer.id,
          null,
          InvoiceKind.MONTHLY,
          addCents,
          orders[0]?.currency || 'USD',
          coversText,
          InvoiceStatus.AWAITING,
          period,
          dueDays,
        ],
      );
      await this.insertInvoiceLines(invoiceId, orders);

      await this.notifyCustomerUser(customer.id, {
        title: 'Monthly statement ready',
        body: coversText,
        link: '/portal/invoices',
      });

      summary.push({
        customerId: customer.id,
        customerName: customer.name,
        amountCents: addCents,
        orderCount: orders.length,
        invoiceId,
      });
    }

    return { periodMonth: period, created: summary };
  }

  async billingSummary(user: AuthUser | undefined) {
    this.assertAdmin(user);
    await this.collapseOrderInvoiceDupes();
    const period = currentPeriodMonth();

    const outstanding = await this.db.queryOne<{
      total: number | string | null;
      pending: number | string | null;
      overdue: number | string | null;
    }>(
      `SELECT
          COALESCE(SUM(GREATEST(0, amount_cents - COALESCE(amount_paid_cents, 0))), 0) AS total,
          COALESCE(SUM(CASE
            WHEN due_at IS NULL OR due_at >= NOW()
            THEN GREATEST(0, amount_cents - COALESCE(amount_paid_cents, 0))
            ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE
            WHEN due_at IS NOT NULL AND due_at < NOW()
            THEN GREATEST(0, amount_cents - COALESCE(amount_paid_cents, 0))
            ELSE 0 END), 0) AS overdue
         FROM invoices
        WHERE status IN (?, ?)`,
      [InvoiceStatus.AWAITING, InvoiceStatus.PARTIAL],
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
      pendingCents: Number(outstanding?.pending ?? 0),
      overdueCents: Number(outstanding?.overdue ?? 0),
      paidThisMonthCents: Number(paidThisMonth?.total ?? 0),
      storeCreditOutstandingCents: Number(storeCredit?.total ?? 0),
      netMonthlyUnbilledCents: unbilled,
    };
  }

  // --- customer (CLIENT) ---------------------------------------------------

  async listMyInvoices(user: AuthUser | undefined) {
    const customer = await this.resolveMyCustomer(user);
    await this.collapseOrderInvoiceDupes(customer.id);
    const rows = await this.db.query<
      InvoiceRow & {
        customer_name: string | null;
        order_ref: string | null;
        service_type: string | null;
        line_order_ids: string | null;
      }
    >(
      `SELECT i.*, c.name AS customer_name, o.human_ref AS order_ref, o.service_type,
              (SELECT GROUP_CONCAT(DISTINCT l.order_id)
                 FROM invoice_lines l
                WHERE l.invoice_id = i.id AND l.order_id IS NOT NULL) AS line_order_ids
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN orders o ON o.id = i.order_id
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
      invoices: await Promise.all(
        invoices.map(async (r) => {
          const linked = new Set<string>();
          if (r.order_id) linked.add(r.order_id);
          for (const id of (r.line_order_ids ?? '').split(',')) {
            if (id) linked.add(id);
          }
          return {
            ...(await this.presentInvoice(r)),
            linkedOrderIds: [...linked],
          };
        }),
      ),
      storeCreditCents: customer.store_credit_cents,
      unbilledMonthCents,
    };
  }

  async myInvoiceSummary(user: AuthUser | undefined) {
    const customer = await this.resolveMyCustomer(user);
    await this.collapseOrderInvoiceDupes(customer.id);
    const row = await this.db.queryOne<{ n: number | string; total: number | string }>(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(GREATEST(0, amount_cents - COALESCE(amount_paid_cents, 0))), 0) AS total
         FROM invoices
        WHERE customer_id = ? AND status IN (?, ?)`,
      [customer.id, InvoiceStatus.AWAITING, InvoiceStatus.PARTIAL],
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
    return { invoice: updated ? await this.presentInvoice(updated) : null };
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
    const lines = await this.db.query<InvoiceLineRow>(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY created_at ASC',
      [invoiceId],
    );

    return buildInvoicePrintHtml(
      invoice,
      payments,
      invoiceLogoSrc(),
      lines,
      this.invoiceImageDataUri(invoice),
      (await this.buildCheckoutSummary(invoice, invoice.amount_cents)).groups,
      await new ThemeService(this.db).get(),
    );
  }
}

function invoiceLogoSrc() {
  const names = ['lvd-logo-print.png', 'lvd-logo.png'];
  const dirs = [
    join(__dirname, 'assets'),
    join(__dirname, '..', 'assets'),
    join(__dirname, '..', '..', 'assets'),
    join(process.cwd(), 'assets'),
    join(process.cwd(), 'apps', 'api', 'assets'),
    join(process.cwd(), '..', 'web', 'public'),
    join(process.cwd(), 'apps', 'web', 'public'),
  ];
  for (const name of names) {
    for (const dir of dirs) {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
    }
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
  if (status === InvoiceStatus.PARTIAL) return 'Partially paid';
  if (status === InvoiceStatus.CANCELLED) return 'Cancelled';
  return 'Due';
}

function paymentMethodLabel(method: PaymentMethod) {
  if (method === PaymentMethod.STORE_CREDIT) return 'Store credit';
  if (method === PaymentMethod.LINK) return 'Payment link';
  return 'Card';
}

export function buildInvoicePrintHtml(
  invoice: InvoiceRow & {
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    order_ref: string | null;
    order_name: string | null;
  },
  payments: PaymentRow[],
  logoSrc = '',
  lines: InvoiceLineRow[] = [],
  imageSrc = '',
  groups: CheckoutGroup[] = [],
  theme: ThemeColors = DEFAULT_THEME_COLORS,
) {
  const ref = invoice.id.slice(0, 8).toUpperCase();
  const money = (cents: number) => formatInvoiceMoney(cents, invoice.currency);
  const issued = formatInvoiceDate(invoice.issued_at);
  const dueOn = formatInvoiceDate(invoice.due_at);
  const paidOn = formatInvoiceDate(invoice.paid_at);
  const remainingCents = invoiceRemainingCents(invoice);
  const paidCents = invoice.amount_paid_cents ?? 0;
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
        <td>${escapeHtml(when || '-')}</td>
        <td>${escapeHtml(label)}</td>
        <td class="num">${escapeHtml(signed)}</td>
      </tr>`;
    })
    .join('');

  const itemRows = groups.length > 0
    ? groups.map((group) => {
        let previous = '';
        return group.items.map((item) => {
          const repeated = previous === item.name;
          previous = item.name;
          return '<tr><td class="item-name">' + escapeHtml(repeated ? '' : item.name) +
            (groups.length > 1 && !repeated && group.orderRef ? '<small class="item-sub">Order ' + escapeHtml(group.orderRef) + '</small>' : '') +
            '</td><td>' + escapeHtml(item.size || item.detail || '—') + '</td><td>' + escapeHtml(item.placement || '—') +
            '</td><td class="num">' + escapeHtml(item.amountCents == null ? '—' : money(item.amountCents)) + '</td></tr>';
        }).join('');
      }).join('')
    : (lines.length ? lines : [{ description, amount_cents: invoice.amount_cents }]).map((line) =>
        '<tr><td class="item-name">' + escapeHtml(line.description) + '</td><td>—</td><td>—</td><td class="num">' + escapeHtml(money(line.amount_cents)) + '</td></tr>',
      ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light only"/>
<title>Invoice LVD-${ref}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap"/>
<style>
  :root { color-scheme: light only; --ink: ${theme.mainText}; --muted: ${theme.secondaryText}; --line: ${theme.formBorder}; --paper: ${theme.cardBg}; --accent: ${theme.buttonBg}; --tint: ${theme.hoverBg}; --ok: ${theme.success}; --due: ${theme.warning}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--tint); color: var(--ink); }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; line-height: 1.45; -webkit-font-smoothing: antialiased; }
  .toolbar { max-width: 816px; margin: 20px auto 0; display: flex; justify-content: flex-end; }
  .toolbar button { font: inherit; font-size: 13px; border: 0; border-radius: 8px; padding: 9px 16px; color: ${theme.buttonText}; background: var(--accent); cursor: pointer; }
  .sheet { width: 8.5in; min-height: 11in; background: var(--paper); margin: 16px auto 40px; padding: .58in .62in .5in; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.08); }
  .brand { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; }
  .mark { max-width: 60%; }
  .logo { width: 290px; max-width: 100%; height: auto; max-height: 78px; object-fit: contain; object-position: left center; }
  .place { margin-top: 8px; font-size: 12px; color: var(--muted); }
  .doc-title { text-align: right; }
  .doc-title h1 { font: inherit; font-size: 44px; font-weight: 700; color: var(--accent); line-height: 1.1; }
  .no { margin-top: 6px; font-size: 14px; color: var(--muted); }
  .stamp { display: inline-block; margin-top: 8px; padding: 4px 13px; border-radius: 4px; font-size: 15px; font-weight: 700; text-transform: uppercase; color: ${theme.buttonText}; background: var(--due); }
  .stamp.ok { background: var(--ok); color: #fff; } .stamp.off { background: var(--muted); color: #fff; }
  .rule { border-top: 1px solid var(--line); margin: 26px 0 22px; }
  .meta { display: grid; grid-template-columns: 1.2fr 1fr; gap: 32px; }
  .k { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .who { font-size: 20px; font-weight: 600; } .soft { font-size: 14px; margin-top: 2px; overflow-wrap: anywhere; }
  .facts { display: grid; grid-template-columns: 76px minmax(0,1fr); gap: 6px 14px; font-size: 13px; }
  .facts dt { color: var(--muted); } .facts dd { overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; }
  .items { margin-top: 26px; table-layout: fixed; }
  .items th, .pay th { background: var(--tint); color: var(--accent); text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .items th, .items td, .pay th, .pay td { border: 1px solid var(--line); padding: 10px 12px; }
  .items th:first-child { width: 30%; } .items th:last-child { width: 22%; }
  .items td { font-size: 13px; vertical-align: top; overflow-wrap: anywhere; }
  .item-name { font-weight: 500; } .item-sub { display: block; color: var(--muted); margin-top: 3px; }
  .num, .items th.num, .pay th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals { width: 46%; margin: 22px 0 0 auto; border-top: 1px solid var(--line); }
  .totals td { padding: 9px 6px; font-size: 14px; } .totals td:first-child { color: var(--muted); }
  .totals .grand td { background: var(--tint); border-top: 1px solid var(--line); color: var(--accent); font-size: 22px; font-weight: 700; }
  .totals .balance td { border-top: 1px solid var(--line); color: var(--ink); font-weight: 700; }
  .note { margin-top: 14px; font-size: 12px; color: var(--muted); }
  .pay { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--line); }
  .pay td { font-size: 13px; }
  .shot { margin-top: 20px; } .shot img { max-width: 100%; max-height: 250px; object-fit: contain; }
  .foot { margin-top: auto; padding-top: 20px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 24px; font-size: 12px; color: var(--muted); }
  .foot strong { display: block; font-size: 14px; color: var(--accent); margin-bottom: 3px; }
  .foot-spacer { min-height: 24px; }
  tr, .meta, .brand, .totals, .foot { break-inside: avoid; }
  @page { size: letter; margin: 12mm; }
  @media print { html, body { background: #fff; } .toolbar { display: none; } .sheet { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; } .foot { margin-top: 24px; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @media screen and (max-width: 850px) { .sheet { width: calc(100% - 24px); min-height: 0; padding: 24px; } .logo { width: 220px; } .doc-title h1 { font-size: 32px; } .meta { gap: 18px; } .totals { width: 60%; } .toolbar { margin-right: 12px; } }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button type="button" id="download-pdf" onclick="downloadPdf()">Download PDF</button>
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
        <div class="place">Embroidery Digitizing · Vector &amp; Print Files · CNC, Laser &amp; 3D Files</div>
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
          ${invoice.order_ref ? `<dt>Order no</dt><dd>${escapeHtml(displayOrderNumber(invoice.order_ref))}</dd>` : ''}
          <dt>Issued</dt><dd>${escapeHtml(issued || '-')}</dd>
          ${dueOn ? `<dt>Due</dt><dd>${escapeHtml(dueOn)}</dd>` : ''}
          ${paidOn ? `<dt>Paid</dt><dd>${escapeHtml(paidOn)}</dd>` : ''}
          ${period ? `<dt>Period</dt><dd>${escapeHtml(period)}</dd>` : ''}
          <dt>Type</dt><dd>${escapeHtml([...new Set(groups.map(group => group.serviceLabel))].join(', ') || kindLabel)}</dd>
        </dl>
      </div>
    </section>
    <table class="items">
      <thead>
        <tr>
          <th>Design</th>
          <th>Size</th>
          <th>Placement</th>
          <th class="num">Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${escapeHtml(money(invoice.amount_cents))}</td></tr>
      <tr class="grand"><td>Total</td><td class="num">${escapeHtml(money(invoice.amount_cents))}</td></tr>
      <tr><td>Amount paid</td><td class="num">${escapeHtml(money(paidCents))}</td></tr>
      ${refundedCents > 0 ? '<tr><td>Refunded</td><td class="num">' + escapeHtml(money(refundedCents)) + '</td></tr>' : ''}
      <tr class="balance"><td>Balance due</td><td class="num">${escapeHtml(money(invoice.status === InvoiceStatus.CANCELLED ? 0 : remainingCents))}</td></tr>
    </table>
    ${invoice.status === InvoiceStatus.CANCELLED ? '<p class="note">This invoice has been cancelled.</p>' : refundedCents >= chargedCents && refundedCents > 0 ? '<p class="note">This invoice was paid and later refunded in full.</p>' : ''}
    ${
      imageSrc
        ? `<section class="shot"><div class="k">Attached image</div><img src="${imageSrc}" alt="${escapeHtml(invoice.image_name || 'Invoice image')}"/></section>`
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
    <div class="foot-spacer"></div>
    <footer class="foot">
      <div>
        <strong>Las Vegas Designs USA</strong>
        sales@lasvegasdesignsusa.com<br/>lasvegasdesignsusa.com
      </div>
      <div style="text-align:right">
        <strong>Thank you for your order.</strong>Questions?
        Message us from your client portal.
      </div>
    </footer>
  </article>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js"></script>
  <script>
    async function downloadPdf() {
      var button = document.getElementById('download-pdf');
      if (!window.html2pdf) {
        button.textContent = 'PDF download unavailable';
        return;
      }
      var label = button.textContent;
      button.disabled = true;
      button.textContent = 'Preparing PDF…';
      if (document.fonts) await document.fonts.ready;
      html2pdf().set({
        margin: 0,
        filename: ${JSON.stringify(`Invoice-LVD-${ref}.pdf`)},
        image: { type: 'jpeg', quality: 0.98 },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      }).from(document.querySelector('.sheet')).save().then(function () {
        button.disabled = false;
        button.textContent = label;
      }).catch(function () {
        button.disabled = false;
        button.textContent = 'Download PDF';
      });
    }
  </script>
</body>
</html>`;
}
