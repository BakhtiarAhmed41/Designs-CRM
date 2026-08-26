import { apiFetch, apiFetchForm } from './api';
import type { Order } from './types';

// --- client ---------------------------------------------------------------
export function createOrder(data: {
  type?: 'ORDER' | 'QUOTE_REQUEST';
  name?: string | null;
  mainCategory?: string | null;
  subCategory?: string | null;
  serviceType: string;
  instructions?: string | null;
  size?: string | null;
  preferences?: unknown;
  turnaroundKey?: string | null;
}) {
  return apiFetch<{ order: Order }>('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listMyOrders(params?: {
  type?: string;
  status?: string;
  lifecycle?: 'active' | 'delivered';
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}) {
  const q = new URLSearchParams();
  if (params?.type) q.set('type', params.type);
  if (params?.status) q.set('status', params.status);
  if (params?.lifecycle) q.set('lifecycle', params.lifecycle);
  if (params?.q) q.set('q', params.q);
  if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params?.dateTo) q.set('dateTo', params.dateTo);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return apiFetch<{
    orders: Order[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    delivered?: number;
    totalCents?: number;
    designs?: number;
  }>(qs ? `/orders?${qs}` : '/orders');
}

export function listMyOrderSummary() {
  return apiFetch<{ awaitingQuote: number; beingPriced: number }>('/orders/summary');
}

export function getMyOrder(id: string) {
  return apiFetch<{ order: Order }>(`/orders/${id}`);
}

export function uploadAttachments(orderId: string, files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  return apiFetchForm<{ attachments: unknown[] }>(
    `/orders/${orderId}/attachments`,
    form,
  );
}

export function adminUploadAttachments(orderId: string, files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  return apiFetchForm<{ attachments: unknown[] }>(
    `/admin/orders/${orderId}/attachments`,
    form,
  );
}

export function acceptQuotation(orderId: string, keepLineIds?: string[]) {
  return apiFetch<{ order: Order }>(`/orders/${orderId}/quotations/accept`, {
    method: 'PATCH',
    body: JSON.stringify(keepLineIds ? { keepLineIds } : {}),
  });
}

export function rejectQuotation(orderId: string, comment?: string) {
  return apiFetch<{ order: Order }>(`/orders/${orderId}/quotations/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ comment }),
  });
}

export function counterQuotation(
  orderId: string,
  data: { amountCents?: number; currency?: string; comment?: string },
) {
  return apiFetch<{ quotation: unknown }>(
    `/orders/${orderId}/quotations/counter`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

// --- admin ----------------------------------------------------------------
export function listAdminOrders(params?: {
  status?: string;
  statuses?: string[];
  olderThanDays?: number;
  updatedOlderThanDays?: number;
  clientId?: string;
  type?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.statuses?.length) q.set('statuses', params.statuses.join(','));
  if (params?.olderThanDays) q.set('olderThanDays', String(params.olderThanDays));
  if (params?.updatedOlderThanDays)
    q.set('updatedOlderThanDays', String(params.updatedOlderThanDays));
  if (params?.clientId) q.set('clientId', params.clientId);
  if (params?.type) q.set('type', params.type);
  if (params?.q) q.set('q', params.q);
  if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params?.dateTo) q.set('dateTo', params.dateTo);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<{
    orders: Order[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  }>(`/admin/orders${suffix}`);
}

export function getAdminOrder(id: string) {
  return apiFetch<{ order: Order }>(`/admin/orders/${id}`);
}

export function proposeQuotation(
  orderId: string,
  data: { amountCents?: number; currency?: string; comment?: string },
) {
  return apiFetch<{ quotation: unknown }>(`/admin/orders/${orderId}/quotations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function approveCounter(orderId: string) {
  return apiFetch<{ order: Order }>(
    `/admin/orders/${orderId}/quotations/counter/approve`,
    { method: 'PATCH' },
  );
}

export function rejectCounter(orderId: string, comment?: string) {
  return apiFetch<{ order: Order }>(
    `/admin/orders/${orderId}/quotations/counter/reject`,
    { method: 'PATCH', body: JSON.stringify({ comment }) },
  );
}

export function adminDuplicateOrder(
  sourceOrderId: string,
  type?: 'ORDER' | 'QUOTE_REQUEST',
) {
  return apiFetch<{ order: Order }>('/admin/orders', {
    method: 'POST',
    body: JSON.stringify({ sourceOrderId, type }),
  });
}

export type AdminCreateOrderInput = {
  type: 'ORDER' | 'QUOTE_REQUEST';
  customerId?: string | null;
  customerName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  serviceType: string;
  size?: string | null;
  name?: string | null;
  designCount?: number | null;
  priceCents?: number | null;
  instructions?: string | null;
  channel?: string | null;
};

export function adminCreateOrder(data: AdminCreateOrderInput) {
  return apiFetch<{
    order: Order;
    payLinkUrl?: string | null;
    quoteUrl?: string | null;
  }>('/admin/orders/create', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function adminUpdateStatus(orderId: string, status: string) {
  return apiFetch<{ order: Order }>(`/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function adminRejectOrder(
  orderId: string,
  data: { reason: string; status?: 'REJECTED' | 'CANCELLED' },
) {
  return apiFetch<{ order: Order }>(`/admin/orders/${orderId}/reject`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function updateOrderNotes(orderId: string, notes: string) {
  return apiFetch<{ order: Order }>(`/admin/orders/${orderId}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}

export function resendOrderFiles(orderId: string) {
  return apiFetch<{ ok: true }>(`/admin/orders/${orderId}/resend-files`, {
    method: 'POST',
  });
}

export function deliverOrder(
  orderId: string,
  files: File[],
  options?: {
    deliveredVia?: 'PORTAL' | 'EMAIL';
    designIds?: string[];
    notifyEmail?: boolean;
    notifySms?: boolean;
    complete?: boolean;
    release?: boolean;
  },
) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  if (options?.deliveredVia) form.append('deliveredVia', options.deliveredVia);
  if (options?.designIds) form.append('designIds', JSON.stringify(options.designIds));
  if (options?.notifyEmail !== undefined)
    form.append('notifyEmail', String(options.notifyEmail));
  if (options?.notifySms !== undefined)
    form.append('notifySms', String(options.notifySms));
  if (options?.complete !== undefined)
    form.append('complete', String(options.complete));
  if (options?.release !== undefined) form.append('release', String(options.release));
  return apiFetchForm<{ order: Order; partial?: boolean }>(
    `/admin/orders/${orderId}/deliveries`,
    form,
  );
}

export function myAttachmentUrl(orderId: string, attachmentId: string) {
  return `/orders/${orderId}/attachments/${attachmentId}/signed-url`;
}
export function myDeliveryFileUrl(orderId: string, fileId: string) {
  return `/orders/${orderId}/delivery-files/${fileId}/signed-url`;
}

export function saveQuoteDraft(serviceKey: string, payload: unknown) {
  return apiFetch<{ id: string }>(`/orders/drafts/${encodeURIComponent(serviceKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ payload }),
  });
}

export function getQuoteDraft(serviceKey: string) {
  return apiFetch<{ draft: { payload: unknown; updatedAt: string } | null }>(
    `/orders/drafts/${encodeURIComponent(serviceKey)}`,
  );
}

export function createQuoteIntent(serviceKey: string, payload: unknown) {
  return apiFetch<{ token: string }>(
    '/public/quote-intents',
    { method: 'POST', body: JSON.stringify({ serviceKey, payload }) },
  );
}

export function claimQuoteIntent(token: string) {
  return apiFetch<{ order: Order }>(`/orders/intents/${encodeURIComponent(token)}/claim`, {
    method: 'POST',
  });
}

export function requestFormat(
  orderId: string,
  data: { format: string; deliveryFileId?: string | null; note?: string | null },
) {
  return apiFetch<{ id: string; status: string }>(
    `/orders/${orderId}/format-requests`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export type FormatRequest = {
  id: string;
  orderId: string;
  format: string;
  note: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  createdAt: string;
  humanRef: string | null;
  orderName: string | null;
};

export function listAdminFormatRequests(orderId?: string) {
  const q = orderId ? `?orderId=${encodeURIComponent(orderId)}` : '';
  return apiFetch<{ requests: FormatRequest[] }>(`/admin/orders/format-requests${q}`);
}

export function updateAdminFormatRequest(
  id: string,
  status: FormatRequest['status'],
) {
  return apiFetch<{ id: string; status: string }>(
    `/admin/orders/format-requests/${id}`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
}
export function adminAttachmentUrl(orderId: string, attachmentId: string) {
  return `/admin/orders/${orderId}/attachments/${attachmentId}/signed-url`;
}
export function adminDeliveryFileUrl(orderId: string, fileId: string) {
  return `/admin/orders/${orderId}/delivery-files/${fileId}/signed-url`;
}
