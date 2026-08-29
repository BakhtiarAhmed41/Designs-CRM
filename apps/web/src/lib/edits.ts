import { apiFetch } from './api';

export type EditKind = 'FREE' | 'PAID';
export type EditStatus = 'PENDING' | 'DONE';

export type EditRequest = {
  id: string;
  orderId: string;
  designId: string | null;
  designIds?: string[];
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

export function listAdminEdits(params?: {
  status?: EditStatus;
  kind?: EditKind;
  assigned?: 'yes' | 'no';
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.kind) q.set('kind', params.kind);
  if (params?.assigned) q.set('assigned', params.assigned);
  if (params?.q) q.set('q', params.q);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{
    edits: EditRequest[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  }>(`/admin/edits${qs}`);
}

export function createAdminEdit(
  orderId: string,
  data: {
    note: string;
    kind: EditKind;
    priceCents?: number | null;
    designId?: string | null;
    designIds?: string[] | null;
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

export function listAdminOrderEdits(orderId: string) {
  return apiFetch<{ edits: EditRequest[] }>(`/admin/orders/${orderId}/edits`);
}

export function requestEdit(orderId: string, note: string, designIds?: string[]) {
  return apiFetch<{ edit: EditRequest }>(`/orders/${orderId}/request-edit`, {
    method: 'POST',
    body: JSON.stringify({ note, designIds }),
  });
}

export function listMyEdits(orderId: string) {
  return apiFetch<{ edits: EditRequest[] }>(`/orders/${orderId}/edits`);
}
