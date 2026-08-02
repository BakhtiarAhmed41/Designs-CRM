import { apiFetch } from './api';

export type EditKind = 'FREE' | 'PAID';
export type EditStatus = 'PENDING' | 'DONE';

export type EditRequest = {
  id: string;
  orderId: string;
  designId: string | null;
  revisionOrderId: string | null;
  note: string;
  kind: EditKind;
  priceCents: number | null;
  status: EditStatus;
  assignedDesignerId: string | null;
  requestedById: string | null;
  createdAt: string;
  resolvedAt: string | null;
  orderRef?: string | null;
  orderName?: string | null;
  designer?: {
    id: string;
    initials: string | null;
    firstName: string | null;
  } | null;
};

export type ActivityEntry = {
  id: string;
  orderId: string | null;
  actorId: string | null;
  event: string;
  meta: unknown;
  createdAt: string;
  actorName?: string | null;
  actorInitials?: string | null;
};

export function listAdminEdits(status?: EditStatus, search?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('q', search);
  const q = params.toString() ? `?${params}` : '';
  return apiFetch<{ edits: EditRequest[] }>(`/admin/edits${q}`);
}

export function createAdminEdit(
  orderId: string,
  data: {
    note: string;
    kind: EditKind;
    priceCents?: number | null;
    designId?: string | null;
    assignedDesignerId?: string | null;
  },
) {
  return apiFetch<{ edit: EditRequest }>(`/admin/orders/${orderId}/edits`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateAdminEdit(
  id: string,
  data: { status?: EditStatus; assignedDesignerId?: string | null },
) {
  return apiFetch<{ edit: EditRequest }>(`/admin/edits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function getOrderActivity(orderId: string) {
  return apiFetch<{ activity: ActivityEntry[] }>(
    `/admin/orders/${orderId}/activity`,
  );
}

export function requestEdit(orderId: string, note: string) {
  return apiFetch<{ edit: EditRequest }>(`/orders/${orderId}/request-edit`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function listMyEdits(orderId: string) {
  return apiFetch<{ edits: EditRequest[] }>(`/orders/${orderId}/edits`);
}
