import { apiFetch } from './api';
import type { OrderStatus } from './types';

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

export const REPORT_OPTIONS: Array<{
  value: ReportKind;
  label: string;
  description: string;
  needsRange: boolean;
}> = [
  {
    value: 'sales',
    label: 'Sales & revenue',
    description: 'Total sales, revenue, paid, pending, refunds, and revenue by date.',
    needsRange: true,
  },
  {
    value: 'orders',
    label: 'Orders',
    description: 'Total orders, completed, in progress, pending, cancelled, and overdue.',
    needsRange: true,
  },
  {
    value: 'quotes',
    label: 'Quotes',
    description: 'Quotes created, approved, rejected, pending review, expired, and conversion.',
    needsRange: true,
  },
  {
    value: 'customers',
    label: 'Customers',
    description: 'New and active customers, top customers, and orders and revenue by customer.',
    needsRange: true,
  },
  {
    value: 'team',
    label: 'Team performance',
    description: 'Assigned, completed, pending, overdue, completion time, and workload by person.',
    needsRange: true,
  },
  {
    value: 'billing',
    label: 'Payment & billing',
    description: 'Invoices generated, paid, unpaid, partly paid, and overdue.',
    needsRange: true,
  },
  {
    value: 'revisions',
    label: 'Revisions',
    description: 'Total revisions, per order, pending, completed, and customers who ask most.',
    needsRange: true,
  },
];

export type SalesReport = {
  totals: {
    totalSales: number;
    revenueCents: number;
    paidCents: number;
    pendingCents: number;
    refunds: number;
    refundedCents: number;
  };
  series: Array<{ date: string; revenueCents: number }>;
};

export type OrdersReport = {
  totals: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    cancelled: number;
    overdue: number;
  };
  byStatus: Array<{ status: OrderStatus; count: number }>;
  series: Array<{ date: string; orders: number }>;
};

export type QuotesReport = {
  totals: {
    created: number;
    approved: number;
    rejected: number;
    pendingReview: number;
    expired: number;
    conversionPercent: number;
  };
  byStatus: Array<{ status: OrderStatus; count: number }>;
};

export type CustomersReport = {
  totals: {
    newCustomers: number;
    activeCustomers: number;
  };
  customers: Array<{
    id: string;
    name: string;
    email: string | null;
    ordersCount: number;
    revenueCents: number;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    email: string | null;
    ordersCount: number;
    revenueCents: number;
  }>;
};

export type TeamReport = {
  totals: {
    assigned: number;
    completed: number;
    pending: number;
    overdue: number;
    avgCompletionHours: number | null;
  };
  members: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    assigned: number;
    completed: number;
    pending: number;
    overdue: number;
    avgCompletionHours: number | null;
  }>;
};

export type BillingReport = {
  totals: {
    generated: number;
    generatedCents: number;
    paid: number;
    paidCents: number;
    unpaid: number;
    unpaidCents: number;
    partial: number;
    partialCents: number;
    overdue: number;
    overdueCents: number;
  };
};

export type RevisionsReport = {
  totals: {
    total: number;
    pending: number;
    completed: number;
    perOrder: number;
  };
  perOrder: Array<{
    orderId: string;
    orderName: string;
    humanRef: string | null;
    count: number;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    email: string | null;
    count: number;
  }>;
};

export type ReportPayload =
  | { kind: 'sales'; range: { startKey: string; endKey: string }; report: SalesReport }
  | { kind: 'orders'; range: { startKey: string; endKey: string }; report: OrdersReport }
  | { kind: 'quotes'; range: { startKey: string; endKey: string }; report: QuotesReport }
  | { kind: 'customers'; range: { startKey: string; endKey: string }; report: CustomersReport }
  | { kind: 'team'; range: { startKey: string; endKey: string }; report: TeamReport }
  | { kind: 'billing'; range: { startKey: string; endKey: string }; report: BillingReport }
  | { kind: 'revisions'; range: { startKey: string; endKey: string }; report: RevisionsReport };

export function getReport(
  type: ReportKind,
  range?: { from?: string; to?: string },
) {
  const q = new URLSearchParams();
  q.set('type', type);
  if (range?.from) q.set('from', range.from);
  if (range?.to) q.set('to', range.to);
  return apiFetch<ReportPayload>(`/admin/reports?${q.toString()}`);
}
