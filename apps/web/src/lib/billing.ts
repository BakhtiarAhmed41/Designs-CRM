import { apiFetch } from './api';
import { authorizationHeader } from './session';

// --- shared types ---------------------------------------------------------
export type InvoiceKind = 'PER_ORDER' | 'MONTHLY' | 'ADD_ON';
export type InvoiceStatus = 'AWAITING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export type PayMethod = 'CARD' | 'STORE_CREDIT';
export type RefundTo = 'CARD' | 'STORE_CREDIT';

export type Invoice = {
  id: string;
  customerId: string;
  customerName: string | null;
  orderId: string | null;
  kind: InvoiceKind;
  amountCents: number;
  amountPaidCents?: number;
  remainingCents?: number;
  currency: string;
  coversText: string | null;
  status: InvoiceStatus;
  periodMonth: string | null;
  storeCreditAppliedCents: number;
  issuedAt: string;
  dueAt?: string | null;
  paidAt: string | null;
};

export function invoiceRemainingCents(inv: Pick<Invoice, 'amountCents' | 'amountPaidCents' | 'remainingCents'>) {
  if (typeof inv.remainingCents === 'number') return Math.max(0, inv.remainingCents);
  return Math.max(0, inv.amountCents - (inv.amountPaidCents ?? 0));
}

export function isInvoiceOpen(status: InvoiceStatus) {
  return status === 'AWAITING' || status === 'PARTIAL';
}

export function isInvoiceOverdue(inv: Pick<Invoice, 'status' | 'dueAt'>) {
  if (!isInvoiceOpen(inv.status) || !inv.dueAt) return false;
  return new Date(inv.dueAt).getTime() < Date.now();
}

export type Payment = {
  id: string;
  invoiceId: string | null;
  orderId: string | null;
  customerId: string | null;
  amountCents: number;
  currency: string;
  method: 'CARD' | 'LINK' | 'STORE_CREDIT';
  type: 'CHARGE' | 'REFUND';
  refundTo: RefundTo | null;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  reason: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type InvoiceDetail = Invoice & {
  customer: {
    id: string;
    name: string;
    email: string | null;
    accountType: 'PAY_PER_ORDER' | 'NET_MONTHLY';
    storeCreditCents: number;
  } | null;
  payments: Payment[];
};

export type StoreCreditEntry = {
  id: string;
  customerId: string;
  deltaCents: number;
  reason: string | null;
  createdAt: string;
};

export type StoreCredit = {
  balanceCents: number;
  entries: StoreCreditEntry[];
};

export type BillingSummary = {
  outstandingCents: number;
  pendingCents?: number;
  overdueCents?: number;
  paidThisMonthCents: number;
  storeCreditOutstandingCents: number;
  netMonthlyUnbilledCents: number;
};

export type MonthEndResult = {
  periodMonth: string;
  created: Array<{
    customerId: string;
    customerName: string;
    amountCents: number;
    orderCount: number;
    invoiceId: string;
  }>;
};

export type PayLinkSummary = {
  amountCents: number;
  amountPaidCents?: number;
  remainingCents?: number;
  currency: string;
  customerName: string | null;
  coversText: string | null;
  status: InvoiceStatus;
  dueAt?: string | null;
  stripeEnabled?: boolean;
};

function pageOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return undefined;
}

function goToCheckout(url: string) {
  window.location.assign(url);
}

// --- admin ----------------------------------------------------------------
export function listInvoices(params?: {
  status?: string;
  customerId?: string;
  q?: string;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.customerId) q.set('customerId', params.customerId);
  if (params?.q) q.set('q', params.q);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<{ invoices: Invoice[] }>(`/admin/invoices${suffix}`);
}

export function getInvoice(id: string) {
  return apiFetch<{ invoice: InvoiceDetail }>(`/admin/invoices/${id}`);
}

export function createInvoice(data: {
  customerId: string;
  orderId?: string | null;
  amountCents: number;
  coversText?: string | null;
}) {
  return apiFetch<{ invoice: InvoiceDetail }>('/admin/invoices', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function payInvoice(id: string, method: PayMethod, amountCents?: number) {
  return apiFetch<{ invoice: InvoiceDetail }>(`/admin/invoices/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ method, amountCents }),
  });
}

export function createPayLink(id: string) {
  return apiFetch<{ token: string; url: string }>(
    `/admin/invoices/${id}/pay-link`,
    { method: 'POST' },
  );
}

export function cancelInvoice(id: string) {
  return apiFetch<{ invoice: InvoiceDetail }>(`/admin/invoices/${id}/cancel`, {
    method: 'POST',
  });
}

export function remindInvoice(id: string) {
  return apiFetch<{ token: string; url: string; invoiceId: string }>(
    `/admin/invoices/${id}/remind`,
    { method: 'POST' },
  );
}

export function refundInvoice(
  id: string,
  data: { amountCents: number; to: RefundTo; reason?: string },
) {
  return apiFetch<{ invoice: InvoiceDetail }>(`/admin/invoices/${id}/refund`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function refundOrder(
  orderId: string,
  data: { amountCents: number; to: RefundTo; reason?: string },
) {
  return apiFetch<{ orderId: string; orderStatus: string | null; payments: Payment[] }>(
    `/admin/orders/${orderId}/refund`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function getStoreCredit(customerId: string) {
  return apiFetch<StoreCredit>(`/admin/customers/${customerId}/store-credit`);
}

export function adjustStoreCredit(
  customerId: string,
  data: { deltaCents: number; reason?: string },
) {
  return apiFetch<StoreCredit>(`/admin/customers/${customerId}/store-credit`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function runMonthEnd(periodMonth?: string) {
  return apiFetch<MonthEndResult>('/admin/billing/month-end', {
    method: 'POST',
    body: JSON.stringify(periodMonth ? { periodMonth } : {}),
  });
}

export function getBillingSummary() {
  return apiFetch<BillingSummary>('/admin/billing/summary');
}

// --- customer -------------------------------------------------------------
export function listMyInvoices() {
  return apiFetch<{
    invoices: Invoice[];
    storeCreditCents: number;
    unbilledMonthCents?: number;
  }>('/invoices');
}

export function getMyInvoiceSummary() {
  return apiFetch<{ awaitingCount: number; awaitingCents: number }>('/invoices/summary');
}

export function payMyInvoice(id: string, method: PayMethod) {
  return apiFetch<{ invoice: Invoice | null; url?: string }>(`/invoices/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ method }),
  });
}

export async function startMyInvoiceCheckout(
  id: string,
  returnPath?: string,
) {
  const res = await apiFetch<{ url: string }>(`/invoices/${id}/checkout`, {
    method: 'POST',
    body: JSON.stringify({
      returnOrigin: pageOrigin(),
      returnPath,
    }),
  });
  if (!res.url) throw new Error('Stripe did not return a checkout URL');
  goToCheckout(res.url);
}

export async function startMyOrderCheckout(orderId: string) {
  const res = await apiFetch<{ url: string }>(
    `/invoices/by-order/${orderId}/checkout`,
    {
      method: 'POST',
      body: JSON.stringify({ returnOrigin: pageOrigin() }),
    },
  );
  if (!res.url) throw new Error('Stripe did not return a checkout URL');
  goToCheckout(res.url);
}

export function confirmMyInvoice(id: string) {
  return apiFetch<{ invoice: Invoice | null }>(`/invoices/${id}/confirm`, {
    method: 'POST',
  });
}

/** Opens printable invoice HTML in a new tab (uses session cookie). */
export async function openInvoicePrint(id: string, admin = false) {
  const base = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api').replace(
    /\/+$/,
    '',
  );
  const path = admin ? `/admin/invoices/${id}/print` : `/invoices/${id}/print`;
  const res = await fetch(`${base}${path}`, {
    credentials: 'include',
    headers: authorizationHeader(),
  });
  if (!res.ok) throw new Error('Could not load invoice for printing');
  const html = await res.text();
  const w = window.open('', '_blank');
  if (!w) throw new Error('Popup blocked. Allow popups to print invoices');
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function getMyStoreCredit() {
  return apiFetch<StoreCredit>('/store-credit');
}

// --- public guest pay-link ------------------------------------------------
export function getPayLinkSummary(token: string) {
  return apiFetch<PayLinkSummary>(`/pay/${token}`);
}

export function payPayLink(token: string) {
  return apiFetch<{ url: string }>(`/pay/${token}`, {
    method: 'POST',
    body: JSON.stringify({ returnOrigin: pageOrigin() }),
  });
}

export async function startPayLinkCheckout(token: string) {
  const res = await apiFetch<{ url: string }>(`/pay/${token}/checkout`, {
    method: 'POST',
    body: JSON.stringify({ returnOrigin: pageOrigin() }),
  });
  if (!res.url) throw new Error('Stripe did not return a checkout URL');
  goToCheckout(res.url);
}

export function confirmPayLink(token: string) {
  return apiFetch<PayLinkSummary>(`/pay/${token}/confirm`, {
    method: 'POST',
  });
}
