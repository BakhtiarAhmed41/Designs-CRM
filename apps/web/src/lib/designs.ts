import { apiFetch } from './api';

export type DesignStatus = 'WAITING' | 'IN_PROGRESS' | 'DONE' | 'DELIVERED';

export type Design = {
  id: string;
  orderId: string;
  name: string;
  placement: string | null;
  size: string | null;
  status: DesignStatus;
  priceCents: number | null;
  requestedFormats: string[] | null;
  sortOrder: number;
  createdAt: string;
};

export type QuotationLineSize = {
  id: string;
  label: string;
  priceCents: number;
  sortOrder: number;
};

export type QuotationLine = {
  id: string;
  name: string;
  note: string | null;
  attachmentId?: string | null;
  priceCents: number | null;
  sortOrder: number;
  clientDecision?: 'PENDING' | 'KEPT' | 'DROPPED';
  sizes: QuotationLineSize[];
};

export type MyFile = {
  orderId: string;
  orderName: string | null;
  humanRef: string | null;
  fileId: string;
  originalName: string;
  formatLabel: string | null;
  deliveredAt: string;
};

export type QuoteBuilderLineInput = {
  name: string;
  note?: string | null;
  attachmentId?: string | null;
  priceCents?: number | null;
  sizes?: Array<{ label: string; priceCents: number }>;
};

export function createDesign(
  orderId: string,
  data: {
    name: string;
    placement?: string | null;
    size?: string | null;
    priceCents?: number | null;
    requestedFormats?: string[] | null;
  },
) {
  return apiFetch<{ design: Design }>(`/admin/orders/${orderId}/designs`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateDesign(
  orderId: string,
  designId: string,
  data: {
    name?: string;
    placement?: string | null;
    size?: string | null;
    status?: DesignStatus;
    priceCents?: number | null;
  },
) {
  return apiFetch<{ design: Design }>(
    `/admin/orders/${orderId}/designs/${designId}`,
    { method: 'PATCH', body: JSON.stringify(data) },
  );
}

export function deleteDesign(orderId: string, designId: string) {
  return apiFetch<{ ok: boolean }>(
    `/admin/orders/${orderId}/designs/${designId}`,
    { method: 'DELETE' },
  );
}

export function submitQuoteBuilder(
  orderId: string,
  data: { comment?: string | null; lines: QuoteBuilderLineInput[] },
) {
  return apiFetch<{ quotation: unknown }>(
    `/admin/orders/${orderId}/quote-builder`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function listMyFiles() {
  return apiFetch<{ files: MyFile[] }>('/orders/my-files');
}
