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

export function getDashboardChart(days = 14) {
  return apiFetch<{ series: ChartPoint[] }>(
    `/admin/dashboard/chart?days=${days}`,
  );
}
