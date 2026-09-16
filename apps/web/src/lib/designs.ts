import { apiFetch } from './api';
import type { Order } from './types';

export type DesignStatus = 'WAITING' | 'IN_PROGRESS' | 'DONE' | 'DELIVERED';

/** Admin keeps Waiting. Customer sees In progress instead. */
export function designStatusLabel(
  status: DesignStatus | string,
  audience: 'admin' | 'customer' = 'admin',
): string {
  switch (status) {
    case 'DELIVERED':
      return 'Delivered';
    case 'DONE':
      return 'Ready';
    case 'IN_PROGRESS':
      return 'In progress';
    default:
      return audience === 'customer' ? 'In progress' : 'Waiting';
  }
}

export function designStatusChipClass(status: DesignStatus | string): string {
  switch (status) {
    case 'DELIVERED':
      return 'chip c-done';
    case 'DONE':
      return 'chip c-review';
    case 'IN_PROGRESS':
      return 'chip c-prog';
    default:
      return 'chip c-wait';
  }
}

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
  serviceType?: string | null;
  fileId: string;
  originalName: string;
  mimeType?: string | null;
  formatLabel: string | null;
  byteSize?: number | null;
  deliveredAt: string;
  deliveredVia?: string | null;
  deliveryEmail?: string | null;
  kind?: 'FINAL' | 'PREVIEW';
  previewStatus?: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | null;
  previewUrl?: string | null;
  canDownload?: boolean;
  downloadedAt?: string | null;
  downloadCount?: number;
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
  return apiFetch<{ quotation: unknown; order: Order }>(
    `/admin/orders/${orderId}/quote-builder`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function listMyFiles() {
  return apiFetch<{ files: MyFile[] }>('/orders/my-files');
}
