import { apiFetch } from './api';
import type { OrderStatus } from './types';

export type DashboardStats = {
  ordersActive: number;
  quotesToPrice: number;
  inProgress: number;
  revisionsOpen: number;
  deliveredThisMonth: number;
  revenueThisMonthCents: number;
  outstandingCents: number;
  newOrders: number;
  unreadMessages: number;
  byStatus: Array<{ status: OrderStatus; count: number }>;
};

export type ChartPoint = {
  date: string;
  orders: number;
  deliveredValueCents: number;
};

export function getDashboardStats() {
  return apiFetch<{ stats: DashboardStats }>('/admin/dashboard/stats');
}

export function getDashboardChart(
  days = 14,
  range?: { from?: string; to?: string },
) {
  const q = new URLSearchParams();
  q.set('days', String(days));
  if (range?.from) q.set('from', range.from);
  if (range?.to) q.set('to', range.to);
  return apiFetch<{ series: ChartPoint[] }>(`/admin/dashboard/chart?${q.toString()}`);
}
