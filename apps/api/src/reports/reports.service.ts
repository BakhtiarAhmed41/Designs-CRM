import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import {
  EditStatus,
  InvoiceStatus,
  OrderStatus,
  OrderType,
  PaymentType,
  UserRole,
} from '../common/enums';
import { DbService } from '../db/db.service';

export const REPORT_KINDS = [
  'sales',
  'orders',
  'quotes',
  'customers',
  'team',
  'billing',
  'revisions',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.WAITING_FOR_QUOTATION,
  OrderStatus.QUOTATION_PROVIDED,
  OrderStatus.CLIENT_REJECTED_QUOTATION,
  OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY_TO_SEND,
  OrderStatus.REVISION_REQUESTED,
];

const DONE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CLOSED,
];

const IN_PROGRESS_STATUSES: OrderStatus[] = [
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY_TO_SEND,
  OrderStatus.REVISION_REQUESTED,
];

const PENDING_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.PENDING_PAYMENT,
];

const CANCELLED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
];

const QUOTE_PENDING_STATUSES: OrderStatus[] = [
  OrderStatus.WAITING_FOR_QUOTATION,
  OrderStatus.QUOTATION_PROVIDED,
  OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL,
];

const QUOTE_APPROVED_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY_TO_SEND,
  OrderStatus.REVISION_REQUESTED,
  OrderStatus.COMPLETED,
  OrderStatus.CLOSED,
];

const STAFF_ROLES: UserRole[] = [
  UserRole.DESIGNER,
  UserRole.ADMIN,
  UserRole.SUPPORT,
  UserRole.SUPER_ADMIN,
];

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function defaultRange(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

function fillSeries<T extends { date: string }>(
  start: Date,
  end: Date,
  byDate: Map<string, T>,
  empty: (date: string) => T,
): T[] {
  const series: T[] = [];
  const cursor = new Date(start);
  const last = new Date(end);
  while (cursor <= last) {
    const key = dateKey(cursor);
    series.push(byDate.get(key) ?? empty(key));
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
}

function n(value: unknown): number {
  return Number(value ?? 0);
}

/** Open job past its due date, or past turnaround hours when no due date is set. */
const OVERDUE_SQL = `
  status IN (${placeholders(OPEN_ORDER_STATUSES)})
  AND (
    (due_date IS NOT NULL AND due_date < CURDATE())
    OR (
      due_date IS NULL
      AND turnaround_hours IS NOT NULL
      AND DATE_ADD(created_at, INTERVAL turnaround_hours HOUR) < NOW()
    )
  )
`;

@Injectable()
export class ReportsService {
  constructor(private db: DbService) {}

  private assertAdmin(user: AuthUser | undefined): asserts user is AuthUser {
    if (!user) throw new ForbiddenException();
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException();
    }
  }

  private resolveRange(from?: string, to?: string): { startKey: string; endKey: string } {
    const parsedFrom = parseDay(from);
    const parsedTo = parseDay(to);
    let start: Date;
    let end: Date;
    if (parsedFrom && parsedTo) {
      start = parsedFrom;
      end = parsedTo;
      if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
      }
    } else {
      ({ start, end } = defaultRange());
    }
    const days =
      Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (days > 366) {
      throw new BadRequestException('Choose a range of 366 days or less.');
    }
    return { startKey: dateKey(start), endKey: dateKey(end) };
  }

  async run(
    user: AuthUser | undefined,
    kind: string,
    from?: string,
    to?: string,
  ) {
    this.assertAdmin(user);
    if (!REPORT_KINDS.includes(kind as ReportKind)) {
      throw new BadRequestException('Unknown report.');
    }
    const report = kind as ReportKind;
    const range = this.resolveRange(from, to);

    switch (report) {
      case 'sales':
        return { kind: report, range, report: await this.sales(range) };
      case 'orders':
        return { kind: report, range, report: await this.orders(range) };
      case 'quotes':
        return { kind: report, range, report: await this.quotes(range) };
      case 'customers':
        return { kind: report, range, report: await this.customers(range) };
      case 'team':
        return { kind: report, range, report: await this.team(range) };
      case 'billing':
        return { kind: report, range, report: await this.billing(range) };
      case 'revisions':
        return { kind: report, range, report: await this.revisions(range) };
    }
  }

  private async sales(range: { startKey: string; endKey: string }) {
    const { startKey, endKey } = range;
    const [orderMoney, invoiceMoney, refunds, daily] = await Promise.all([
      this.db.queryOne<{ sales: number; revenue: number | null }>(
        `SELECT COUNT(*) AS sales, COALESCE(SUM(price_cents), 0) AS revenue
           FROM orders
          WHERE type = ?
            AND status IN (${placeholders(DONE_ORDER_STATUSES)})
            AND COALESCE(completed_at, closed_at) >= ?
            AND COALESCE(completed_at, closed_at) < DATE_ADD(?, INTERVAL 1 DAY)`,
        [OrderType.ORDER, ...DONE_ORDER_STATUSES, startKey, endKey],
      ),
      this.db.queryOne<{
        paid: number | null;
        pending: number | null;
      }>(
        `SELECT
            SUM(CASE WHEN status = ? AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY) THEN amount_cents ELSE 0 END) AS paid,
            SUM(CASE WHEN status IN (?, ?) AND issued_at >= ? AND issued_at < DATE_ADD(?, INTERVAL 1 DAY) THEN GREATEST(0, amount_cents - COALESCE(amount_paid_cents, 0)) ELSE 0 END) AS pending
           FROM invoices`,
        [
          InvoiceStatus.PAID,
          startKey,
          endKey,
          InvoiceStatus.AWAITING,
          InvoiceStatus.PARTIAL,
          startKey,
          endKey,
        ],
      ),
      this.db.queryOne<{ count: number; amount: number | null }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount
           FROM payments
          WHERE type = ?
            AND COALESCE(paid_at, created_at) >= ?
            AND COALESCE(paid_at, created_at) < DATE_ADD(?, INTERVAL 1 DAY)`,
        [PaymentType.REFUND, startKey, endKey],
      ),
      this.db.query<{ d: string; revenue: number | null }>(
        `SELECT DATE_FORMAT(COALESCE(completed_at, closed_at), '%Y-%m-%d') AS d,
                COALESCE(SUM(price_cents), 0) AS revenue
           FROM orders
          WHERE type = ?
            AND status IN (${placeholders(DONE_ORDER_STATUSES)})
            AND COALESCE(completed_at, closed_at) IS NOT NULL
            AND COALESCE(completed_at, closed_at) >= ?
            AND COALESCE(completed_at, closed_at) < DATE_ADD(?, INTERVAL 1 DAY)
          GROUP BY DATE_FORMAT(COALESCE(completed_at, closed_at), '%Y-%m-%d')`,
        [OrderType.ORDER, ...DONE_ORDER_STATUSES, startKey, endKey],
      ),
    ]);

    const byDate = new Map(
      daily.map((row) => [row.d, { date: row.d, revenueCents: n(row.revenue) }]),
    );

    return {
      totals: {
        totalSales: n(orderMoney?.sales),
        revenueCents: n(orderMoney?.revenue),
        paidCents: n(invoiceMoney?.paid),
        pendingCents: n(invoiceMoney?.pending),
        refunds: n(refunds?.count),
        refundedCents: n(refunds?.amount),
      },
      series: fillSeries(
        new Date(`${startKey}T00:00:00`),
        new Date(`${endKey}T00:00:00`),
        byDate,
        (date) => ({ date, revenueCents: 0 }),
      ),
    };
  }

  private async orders(range: { startKey: string; endKey: string }) {
    const { startKey, endKey } = range;
    const where = `type = ? AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`;
    const [totals, byStatus, daily] = await Promise.all([
      this.db.queryOne<{
        total: number;
        completed: number;
        in_progress: number;
        pending: number;
        cancelled: number;
        overdue: number;
      }>(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status IN (${placeholders(DONE_ORDER_STATUSES)}) THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status IN (${placeholders(IN_PROGRESS_STATUSES)}) THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN status IN (${placeholders(PENDING_ORDER_STATUSES)}) THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status IN (${placeholders(CANCELLED_ORDER_STATUSES)}) THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN ${OVERDUE_SQL} THEN 1 ELSE 0 END) AS overdue
           FROM orders
          WHERE ${where}`,
        [
          ...DONE_ORDER_STATUSES,
          ...IN_PROGRESS_STATUSES,
          ...PENDING_ORDER_STATUSES,
          ...CANCELLED_ORDER_STATUSES,
          ...OPEN_ORDER_STATUSES,
          OrderType.ORDER,
          startKey,
          endKey,
        ],
      ),
      this.db.query<{ status: OrderStatus; count: number }>(
        `SELECT status, COUNT(*) AS count FROM orders WHERE ${where} GROUP BY status ORDER BY count DESC`,
        [OrderType.ORDER, startKey, endKey],
      ),
      this.db.query<{ d: string; c: number }>(
        `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
           FROM orders WHERE ${where}
          GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')`,
        [OrderType.ORDER, startKey, endKey],
      ),
    ]);

    const byDate = new Map(
      daily.map((row) => [row.d, { date: row.d, orders: n(row.c) }]),
    );

    return {
      totals: {
        total: n(totals?.total),
        completed: n(totals?.completed),
        inProgress: n(totals?.in_progress),
        pending: n(totals?.pending),
        cancelled: n(totals?.cancelled),
        overdue: n(totals?.overdue),
      },
      byStatus: byStatus.map((row) => ({ status: row.status, count: n(row.count) })),
      series: fillSeries(
        new Date(`${startKey}T00:00:00`),
        new Date(`${endKey}T00:00:00`),
        byDate,
        (date) => ({ date, orders: 0 }),
      ),
    };
  }

  private async quotes(range: { startKey: string; endKey: string }) {
    const { startKey, endKey } = range;
    const quoteScope = `
      created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
      AND (
        type = ?
        OR EXISTS (SELECT 1 FROM quotations q WHERE q.order_id = orders.id)
      )
    `;
    const [totals, byStatus] = await Promise.all([
      this.db.queryOne<{
        created: number;
        approved: number;
        rejected: number;
        pending: number;
        expired: number;
      }>(
        `SELECT
            COUNT(*) AS created,
            SUM(CASE WHEN status IN (${placeholders(QUOTE_APPROVED_STATUSES)}) OR approved_at IS NOT NULL THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN status IN (${placeholders(QUOTE_PENDING_STATUSES)}) THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS expired
           FROM orders
          WHERE ${quoteScope}`,
        [
          ...QUOTE_APPROVED_STATUSES,
          OrderStatus.CLIENT_REJECTED_QUOTATION,
          OrderStatus.REJECTED,
          ...QUOTE_PENDING_STATUSES,
          OrderStatus.CANCELLED,
          startKey,
          endKey,
          OrderType.QUOTE_REQUEST,
        ],
      ),
      this.db.query<{ status: OrderStatus; count: number }>(
        `SELECT status, COUNT(*) AS count FROM orders WHERE ${quoteScope} GROUP BY status ORDER BY count DESC`,
        [startKey, endKey, OrderType.QUOTE_REQUEST],
      ),
    ]);

    const created = n(totals?.created);
    const approved = n(totals?.approved);
    return {
      totals: {
        created,
        approved,
        rejected: n(totals?.rejected),
        pendingReview: n(totals?.pending),
        expired: n(totals?.expired),
        conversionPercent: created > 0 ? Math.round((approved / created) * 100) : 0,
      },
      byStatus: byStatus.map((row) => ({ status: row.status, count: n(row.count) })),
    };
  }

  private async customers(range: { startKey: string; endKey: string }) {
    const { startKey, endKey } = range;
    const [totals, rows] = await Promise.all([
      this.db.queryOne<{ new_customers: number; active_customers: number }>(
        `SELECT
            (SELECT COUNT(*) FROM customers
              WHERE merged_into_id IS NULL
                AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
            ) AS new_customers,
            (SELECT COUNT(DISTINCT customer_id) FROM orders
              WHERE customer_id IS NOT NULL
                AND type = ?
                AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
            ) AS active_customers`,
        [startKey, endKey, OrderType.ORDER, startKey, endKey],
      ),
      this.db.query<{
        id: string;
        name: string;
        email: string | null;
        orders_count: number;
        revenue: number | null;
      }>(
        `SELECT c.id, c.name, c.email,
                COUNT(o.id) AS orders_count,
                COALESCE(SUM(CASE WHEN o.status IN (${placeholders(DONE_ORDER_STATUSES)}) THEN o.price_cents ELSE 0 END), 0) AS revenue
           FROM customers c
           JOIN orders o
             ON o.customer_id = c.id
            AND o.type = ?
            AND o.created_at >= ?
            AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
          WHERE c.merged_into_id IS NULL
          GROUP BY c.id, c.name, c.email
          ORDER BY revenue DESC, orders_count DESC
          LIMIT 50`,
        [...DONE_ORDER_STATUSES, OrderType.ORDER, startKey, endKey],
      ),
    ]);

    const customers = rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      ordersCount: n(row.orders_count),
      revenueCents: n(row.revenue),
    }));

    return {
      totals: {
        newCustomers: n(totals?.new_customers),
        activeCustomers: n(totals?.active_customers),
      },
      customers,
      topCustomers: customers.slice(0, 10),
    };
  }

  private async team(range: { startKey: string; endKey: string }) {
    const { startKey, endKey } = range;
    const rows = await this.db.query<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      role: UserRole;
      assigned: number;
      completed: number;
      pending: number;
      overdue: number;
      avg_hours: number | null;
    }>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
              COALESCE(a.assigned, 0) AS assigned,
              COALESCE(c.completed, 0) AS completed,
              COALESCE(p.pending, 0) AS pending,
              COALESCE(v.overdue, 0) AS overdue,
              c.avg_hours
         FROM users u
         LEFT JOIN (
           SELECT assigned_designer_id AS id, COUNT(*) AS assigned
             FROM orders
            WHERE assigned_designer_id IS NOT NULL
              AND type = ?
              AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
            GROUP BY assigned_designer_id
         ) a ON a.id = u.id
         LEFT JOIN (
           SELECT assigned_designer_id AS id,
                  COUNT(*) AS completed,
                  AVG(TIMESTAMPDIFF(HOUR, COALESCE(approved_at, created_at), COALESCE(completed_at, closed_at))) AS avg_hours
             FROM orders
            WHERE assigned_designer_id IS NOT NULL
              AND type = ?
              AND status IN (${placeholders(DONE_ORDER_STATUSES)})
              AND COALESCE(completed_at, closed_at) >= ?
              AND COALESCE(completed_at, closed_at) < DATE_ADD(?, INTERVAL 1 DAY)
            GROUP BY assigned_designer_id
         ) c ON c.id = u.id
         LEFT JOIN (
           SELECT assigned_designer_id AS id, COUNT(*) AS pending
             FROM orders
            WHERE assigned_designer_id IS NOT NULL
              AND type = ?
              AND status IN (${placeholders(OPEN_ORDER_STATUSES)})
            GROUP BY assigned_designer_id
         ) p ON p.id = u.id
         LEFT JOIN (
           SELECT assigned_designer_id AS id, COUNT(*) AS overdue
             FROM orders
            WHERE assigned_designer_id IS NOT NULL
              AND type = ?
              AND ${OVERDUE_SQL}
            GROUP BY assigned_designer_id
         ) v ON v.id = u.id
        WHERE u.role IN (${placeholders(STAFF_ROLES)})
          AND (u.role = ? OR COALESCE(a.assigned, 0) > 0 OR COALESCE(c.completed, 0) > 0 OR COALESCE(p.pending, 0) > 0)
        ORDER BY assigned DESC, completed DESC, u.email`,
      [
        OrderType.ORDER,
        startKey,
        endKey,
        OrderType.ORDER,
        ...DONE_ORDER_STATUSES,
        startKey,
        endKey,
        OrderType.ORDER,
        ...OPEN_ORDER_STATUSES,
        OrderType.ORDER,
        ...OPEN_ORDER_STATUSES,
        ...STAFF_ROLES,
        UserRole.DESIGNER,
      ],
    );

    const members = rows.map((row) => ({
      id: row.id,
      name:
        [row.first_name, row.last_name].filter(Boolean).join(' ') ||
        row.email.split('@')[0],
      email: row.email,
      role: row.role,
      assigned: n(row.assigned),
      completed: n(row.completed),
      pending: n(row.pending),
      overdue: n(row.overdue),
      avgCompletionHours: row.avg_hours != null ? Math.round(n(row.avg_hours)) : null,
    }));

    const withTime = members.filter((m) => m.avgCompletionHours != null);
    const avgCompletionHours =
      withTime.length > 0
        ? Math.round(
            withTime.reduce((sum, m) => sum + (m.avgCompletionHours ?? 0), 0) /
              withTime.length,
          )
        : null;

    return {
      totals: {
        assigned: members.reduce((sum, m) => sum + m.assigned, 0),
        completed: members.reduce((sum, m) => sum + m.completed, 0),
        pending: members.reduce((sum, m) => sum + m.pending, 0),
        overdue: members.reduce((sum, m) => sum + m.overdue, 0),
        avgCompletionHours,
      },
      members,
    };
  }

  private async billing(range: { startKey: string; endKey: string }) {
    const { startKey, endKey } = range;
    const [period, overdue] = await Promise.all([
      this.db.queryOne<{
        generated: number;
        paid: number;
        unpaid: number;
        partial: number;
        generated_cents: number | null;
        paid_cents: number | null;
        unpaid_cents: number | null;
        partial_cents: number | null;
      }>(
        `SELECT
            COUNT(*) AS generated,
            SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS paid,
            SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS unpaid,
            SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS partial,
            COALESCE(SUM(amount_cents), 0) AS generated_cents,
            SUM(CASE WHEN status = ? THEN amount_cents ELSE 0 END) AS paid_cents,
            SUM(CASE WHEN status = ? THEN GREATEST(0, amount_cents - COALESCE(amount_paid_cents, 0)) ELSE 0 END) AS unpaid_cents,
            SUM(CASE WHEN status = ? THEN GREATEST(0, amount_cents - COALESCE(amount_paid_cents, 0)) ELSE 0 END) AS partial_cents
           FROM invoices
          WHERE issued_at >= ? AND issued_at < DATE_ADD(?, INTERVAL 1 DAY)`,
        [
          InvoiceStatus.PAID,
          InvoiceStatus.AWAITING,
          InvoiceStatus.PARTIAL,
          InvoiceStatus.PAID,
          InvoiceStatus.AWAITING,
          InvoiceStatus.PARTIAL,
          startKey,
          endKey,
        ],
      ),
      this.db.queryOne<{ count: number; amount: number | null }>(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(GREATEST(0, i.amount_cents - COALESCE(i.amount_paid_cents, 0))), 0) AS amount
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id
          WHERE i.status IN (?, ?)
            AND i.issued_at >= ? AND i.issued_at < DATE_ADD(?, INTERVAL 1 DAY)
            AND COALESCE(
                  i.due_at,
                  DATE_ADD(i.issued_at, INTERVAL
                    CASE c.net_terms
                      WHEN 'NET_15' THEN 15
                      WHEN 'NET_30' THEN 30
                      ELSE 30
                    END DAY)
                ) < NOW()`,
        [InvoiceStatus.AWAITING, InvoiceStatus.PARTIAL, startKey, endKey],
      ),
    ]);

    return {
      totals: {
        generated: n(period?.generated),
        generatedCents: n(period?.generated_cents),
        paid: n(period?.paid),
        paidCents: n(period?.paid_cents),
        unpaid: n(period?.unpaid),
        unpaidCents: n(period?.unpaid_cents),
        partial: n(period?.partial),
        partialCents: n(period?.partial_cents),
        overdue: n(overdue?.count),
        overdueCents: n(overdue?.amount),
      },
    };
  }

  private async revisions(range: { startKey: string; endKey: string }) {
    const { startKey, endKey } = range;
    const where = `er.created_at >= ? AND er.created_at < DATE_ADD(?, INTERVAL 1 DAY)`;
    const [totals, perOrder, byCustomer] = await Promise.all([
      this.db.queryOne<{
        total: number;
        pending: number;
        completed: number;
        orders: number;
      }>(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN er.status = ? THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN er.status = ? THEN 1 ELSE 0 END) AS completed,
            COUNT(DISTINCT er.order_id) AS orders
           FROM edit_requests er
          WHERE ${where}`,
        [EditStatus.PENDING, EditStatus.DONE, startKey, endKey],
      ),
      this.db.query<{
        order_id: string;
        order_name: string | null;
        human_ref: string | null;
        count: number;
      }>(
        `SELECT er.order_id, o.name AS order_name, o.human_ref, COUNT(*) AS count
           FROM edit_requests er
           JOIN orders o ON o.id = er.order_id
          WHERE ${where}
          GROUP BY er.order_id, o.name, o.human_ref
          ORDER BY count DESC
          LIMIT 15`,
        [startKey, endKey],
      ),
      this.db.query<{
        id: string;
        name: string;
        email: string | null;
        count: number;
      }>(
        `SELECT c.id, c.name, c.email, COUNT(*) AS count
           FROM edit_requests er
           JOIN orders o ON o.id = er.order_id
           JOIN customers c ON c.id = o.customer_id
          WHERE ${where}
          GROUP BY c.id, c.name, c.email
          ORDER BY count DESC
          LIMIT 15`,
        [startKey, endKey],
      ),
    ]);

    const total = n(totals?.total);
    const ordersWithRevisions = n(totals?.orders);
    return {
      totals: {
        total,
        pending: n(totals?.pending),
        completed: n(totals?.completed),
        perOrder:
          ordersWithRevisions > 0
            ? Math.round((total / ordersWithRevisions) * 10) / 10
            : 0,
      },
      perOrder: perOrder.map((row) => ({
        orderId: row.order_id,
        orderName: row.order_name ?? row.human_ref ?? 'Order',
        humanRef: row.human_ref,
        count: n(row.count),
      })),
      topCustomers: byCustomer.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        count: n(row.count),
      })),
    };
  }
}
