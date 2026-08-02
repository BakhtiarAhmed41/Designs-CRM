import { apiFetch } from './api';
import type { OrderStatus } from './types';

export type AccountType = 'PAY_PER_ORDER' | 'NET_MONTHLY';
export type NetTerms = 'NET_15' | 'NET_30';
export type CustomerSource = 'PORTAL' | 'ETSY' | 'GUEST' | 'TEXT';

export type Customer = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  accountType: AccountType;
  netTerms: NetTerms | null;
  source: CustomerSource;
  storeCreditCents: number;
  sinceDate: string | null;
  mergedIntoId: string | null;
  preferences?: unknown;
  ordersCount?: number;
  ltvCents?: number;
  runningOrders?: number;
  loginStatus?: 'PENDING' | 'ACTIVE' | 'DISABLED' | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerRecentOrder = {
  id: string;
  humanRef: string | null;
  name: string | null;
  status: OrderStatus;
  priceCents: number | null;
  currency: string;
  createdAt: string;
};

export type CustomerDetail = Customer & {
  openInvoicesCount: number;
  recentOrders: CustomerRecentOrder[];
};

export type CustomerInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  accountType: AccountType;
  netTerms?: NetTerms | null;
  source: CustomerSource;
  active?: boolean;
};

export function listCustomers(params?: {
  q?: string;
  accountType?: string;
  page?: number;
  pageSize?: number;
}) {
  const q = new URLSearchParams();
  if (params?.q) q.set('q', params.q);
  if (params?.accountType) q.set('accountType', params.accountType);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<{
    customers: Customer[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  }>(`/admin/customers${suffix}`);
}

export function getCustomer(id: string) {
  return apiFetch<{ customer: CustomerDetail }>(`/admin/customers/${id}`);
}

export function createCustomer(data: CustomerInput) {
  return apiFetch<{ customer: CustomerDetail }>('/admin/customers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCustomer(id: string, data: Partial<CustomerInput>) {
  return apiFetch<{ customer: CustomerDetail }>(`/admin/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function mergeCustomer(id: string, intoId: string) {
  return apiFetch<{ sourceId: string; intoId: string }>(
    `/admin/customers/${id}/merge`,
    { method: 'POST', body: JSON.stringify({ intoId }) },
  );
}

export function deleteCustomer(id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/customers/${id}`, { method: 'DELETE' });
}

export function getMyCustomer() {
  return apiFetch<{ customer: Customer | null }>('/me/customer');
}

export function updateMyCustomer(data: {
  name?: string;
  phone?: string | null;
  preferences?: unknown;
}) {
  return apiFetch<{ customer: Customer }>('/me/customer', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
