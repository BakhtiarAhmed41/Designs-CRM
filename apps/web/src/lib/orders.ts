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
}) {
  return apiFetch<{ order: Order }>('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listMyOrders() {
  return apiFetch<{ orders: Order[] }>('/orders');
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
export function adminAttachmentUrl(orderId: string, attachmentId: string) {
  return `/admin/orders/${orderId}/attachments/${attachmentId}/signed-url`;
}
export function adminDeliveryFileUrl(orderId: string, fileId: string) {
  return `/admin/orders/${orderId}/delivery-files/${fileId}/signed-url`;
}
