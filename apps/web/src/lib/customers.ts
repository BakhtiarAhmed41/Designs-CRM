import { apiFetch } from './api';
import { normalizeHex } from './theme';
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
  quantity?: number;
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

export type PortalLook = {
  headingColor?: string;
  backgroundColor?: string;
};

export function portalLookFromPrefs(prefs: unknown): PortalLook {
  if (typeof prefs === 'string') {
    try { prefs = JSON.parse(prefs); } catch { return {}; }
  }
  if (!prefs || typeof prefs !== 'object') return {};
  const look = (prefs as { portalLook?: unknown }).portalLook;
  if (!look || typeof look !== 'object') return {};
  const rec = look as Record<string, unknown>;
  return {
    headingColor: typeof rec.headingColor === 'string' ? normalizeHex(rec.headingColor) ?? undefined : undefined,
    backgroundColor: typeof rec.backgroundColor === 'string' ? normalizeHex(rec.backgroundColor) ?? undefined : undefined,
  };
}

export function portalLookStyle(look: PortalLook): Record<string, string | undefined> {
  const background = look.backgroundColor && normalizeHex(look.backgroundColor);
  const heading = look.headingColor && normalizeHex(look.headingColor);
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((start) => {
      const value = parseInt(hex.slice(start, start + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const dark = background ? luminance(background) < 0.2 : false;
  let pageHeading = heading || undefined;
  if (background && heading) {
    const bg = luminance(background), fg = luminance(heading);
    if ((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) < 3) pageHeading = dark ? '#FFFFFF' : '#222222';
  }
  return {
    '--portal-heading': heading || undefined,
    '--portal-page-bg': background || undefined,
    '--portal-page-heading': pageHeading,
    '--portal-page-muted': dark ? '#D1D5DB' : undefined,
  };
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
