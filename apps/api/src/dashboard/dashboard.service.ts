import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { EditStatus, OrderStatus, UserRole } from '../common/enums';
import { DbService } from '../db/db.service';

function isStaffRole(role: UserRole): boolean {
  return (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.ADMIN ||
    role === UserRole.SUPPORT ||
    role === UserRole.DESIGNER
  );
}

/** Orders that are still "open" / in flight (not in a terminal state). */
const ACTIVE_STATUSES: OrderStatus[] = [
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

const QUOTE_STATUSES: OrderStatus[] = [
  OrderStatus.WAITING_FOR_QUOTATION,
  OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL,
];

const OUTSTANDING_STATUSES: OrderStatus[] = [
  OrderStatus.IN_PROGRESS,
  OrderStatus.PENDING_PAYMENT,
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

@Injectable()
export class DashboardService {
  constructor(private db: DbService) {}

  private assertStaff(user: AuthUser | undefined): asserts user is AuthUser {
    if (!user) throw new ForbiddenException();
    if (!isStaffRole(user.role)) throw new ForbiddenException();
  }

  private async countByStatuses(statuses: OrderStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM orders WHERE status IN (${placeholders(statuses)})`,
      statuses,
    );
    return Number(row?.n ?? 0);
  }

  async getStats(user: AuthUser | undefined) {
    this.assertStaff(user);

    const ordersActive = await this.countByStatuses(ACTIVE_STATUSES);
    const quotesToPrice = await this.countByStatuses(QUOTE_STATUSES);
    const inProgress = await this.countByStatuses([OrderStatus.IN_PROGRESS]);

    const revisionsRow = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM edit_requests WHERE status = ?',
      [EditStatus.PENDING],
    );
    const revisionsOpen = Number(revisionsRow?.n ?? 0);

    const deliveredRow = await this.db.queryOne<{ n: number; total: number | null }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(price_cents), 0) AS total
         FROM orders
        WHERE status = ?
          AND completed_at IS NOT NULL
          AND completed_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      [OrderStatus.COMPLETED],
    );
    const deliveredThisMonth = Number(deliveredRow?.n ?? 0);
    const revenueThisMonthCents = Number(deliveredRow?.total ?? 0);

    const outstandingRow = await this.db.queryOne<{ total: number | null }>(
      `SELECT COALESCE(SUM(price_cents), 0) AS total
         FROM orders
        WHERE status IN (${placeholders(OUTSTANDING_STATUSES)})`,
      OUTSTANDING_STATUSES,
    );
    const outstandingCents = Number(outstandingRow?.total ?? 0);

    const byStatusRows = await this.db.query<{ status: OrderStatus; count: number }>(
      'SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC',
    );
    const byStatus = byStatusRows.map((r) => ({
      status: r.status,
      count: Number(r.count),
    }));

    return {
      ordersActive,
      quotesToPrice,
      inProgress,
      revisionsOpen,
      deliveredThisMonth,
      revenueThisMonthCents,
      outstandingCents,
      byStatus,
    };
  }

  async getChart(user: AuthUser | undefined, days: number) {
    this.assertStaff(user);
    const n = Math.min(Math.max(Math.trunc(days) || 14, 1), 90);

    // created orders per day
    const ordersRows = await this.db.query<{ d: string; c: number }>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
         FROM orders
        WHERE created_at >= (CURDATE() - INTERVAL ? DAY)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')`,
      [n - 1],
    );
    // delivered value per day (by completion date)
    const deliveredRows = await this.db.query<{ d: string; v: number }>(
      `SELECT DATE_FORMAT(completed_at, '%Y-%m-%d') AS d, COALESCE(SUM(price_cents), 0) AS v
         FROM orders
        WHERE completed_at IS NOT NULL
          AND completed_at >= (CURDATE() - INTERVAL ? DAY)
        GROUP BY DATE_FORMAT(completed_at, '%Y-%m-%d')`,
      [n - 1],
    );

    const ordersMap = new Map<string, number>();
    for (const r of ordersRows) ordersMap.set(r.d, Number(r.c));
    const deliveredMap = new Map<string, number>();
    for (const r of deliveredRows) deliveredMap.set(r.d, Number(r.v));

    const series: Array<{
      date: string;
      orders: number;
      deliveredValueCents: number;
    }> = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const dt = new Date(today);
      dt.setDate(today.getDate() - i);
      const key = dateKey(dt);
      series.push({
        date: key,
        orders: ordersMap.get(key) ?? 0,
        deliveredValueCents: deliveredMap.get(key) ?? 0,
      });
    }
    return series;
  }
}
