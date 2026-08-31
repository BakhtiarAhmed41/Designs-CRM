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

export function getDashboardStats() {
  return apiFetch<{ stats: DashboardStats }>('/admin/dashboard/stats');
}
