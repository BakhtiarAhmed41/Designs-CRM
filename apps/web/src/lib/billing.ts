import { apiFetch } from './api';

// --- shared types ---------------------------------------------------------
export type InvoiceKind = 'PER_ORDER' | 'MONTHLY';
export type InvoiceStatus = 'AWAITING' | 'PAID' | 'CANCELLED';
export type PayMethod = 'CARD' | 'STORE_CREDIT';
export type RefundTo = 'CARD' | 'STORE_CREDIT';

export type Invoice = {
  id: string;
  customerId: string;
  customerName: string | null;
  orderId: string | null;
  kind: InvoiceKind;
  amountCents: number;
  currency: string;
  coversText: string | null;
  status: InvoiceStatus;
  periodMonth: string | null;
  storeCreditAppliedCents: number;
  issuedAt: string;
  paidAt: string | null;
};

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
  paidThisMonthCents: number;
  storeCreditOutstandingCents: number;
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
  currency: string;
  customerName: string | null;
  coversText: string | null;
  status: InvoiceStatus;
};

// --- admin ----------------------------------------------------------------
export function listInvoices(params?: { status?: string; customerId?: string }) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.customerId) q.set('customerId', params.customerId);
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

export function payInvoice(id: string, method: PayMethod) {
  return apiFetch<{ invoice: InvoiceDetail }>(`/admin/invoices/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ method }),
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
  return apiFetch<{ invoices: Invoice[]; storeCreditCents: number }>('/invoices');
}

export function payMyInvoice(id: string, method: PayMethod) {
  return apiFetch<{ invoice: Invoice | null }>(`/invoices/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ method }),
  });
}

/** Opens printable invoice HTML in a new tab (uses session cookie). */
export async function openInvoicePrint(id: string, admin = false) {
  const base = (import.meta.env.VITE_API_BASE_URL as string).replace(/\/+$/, '');
  const path = admin ? `/admin/invoices/${id}/print` : `/invoices/${id}/print`;
  const res = await fetch(`${base}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Could not load invoice for printing');
  const html = await res.text();
  const w = window.open('', '_blank');
  if (!w) throw new Error('Popup blocked — allow popups to print invoices');
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
  return apiFetch<{ status: InvoiceStatus }>(`/pay/${token}`, {
    method: 'POST',
  });
}
