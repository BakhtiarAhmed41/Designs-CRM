import { apiFetch } from './api';
import type { OrderStatus } from './types';

export type DashboardStats = {
  ordersActive: number;
  quotesToPrice: number;
  inProgress: number;
  revisionsOpen: number;
  deliveredThisMonth: number;
  revenueThisMonthCents: number;
  pendingCents: number;
  overdueCents: number;
  outstandingCents: number;
  newOrders: number;
  unreadMessages: number;
  byStatus: Array<{ status: OrderStatus; count: number }>;
};

export function getDashboardStats(range?: { from?: string; to?: string }) {
  const q = new URLSearchParams();
  if (range?.from) q.set('from', range.from);
  if (range?.to) q.set('to', range.to);
  const qs = q.toString();
  return apiFetch<{ stats: DashboardStats }>(
    qs ? `/admin/dashboard/stats?${qs}` : '/admin/dashboard/stats',
  );
}
