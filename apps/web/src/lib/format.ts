import type { OrderPaymentStatus, OrderStatus } from './types';

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'heic',
  'avif',
]);

/**
 * Show a short label when a file was saved with a generated storage-style name
 * (long random id + extension) instead of dumping the whole string in the UI.
 */
export function friendlyFileName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'File';

  const lastDot = trimmed.lastIndexOf('.');
  const ext = lastDot > 0 ? trimmed.slice(lastDot + 1) : '';
  const extOk = /^[A-Za-z0-9]{1,8}$/.test(ext);
  const base = (extOk ? trimmed.slice(0, lastDot) : trimmed).replace(/\s*\(\d+\)$/, '');
  const generated =
    /^Gemini_Generated/i.test(base) ||
    (base.length >= 28 && /^[A-Za-z0-9_-]+$/.test(base));

  if (generated) {
    const lower = extOk ? ext.toLowerCase() : '';
    if (IMAGE_EXTS.has(lower)) return 'Reference image';
    if (lower === 'pdf') return 'Reference PDF';
    return extOk ? `Reference file (.${lower})` : 'Reference file';
  }

  return trimmed;
}

export function isImageFile(name?: string | null, mime?: string | null) {
  if (mime?.startsWith('image/')) return true;
  const ext = name?.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTS.has(ext);
}

export function sameFileName(a?: string | null, b?: string | null) {
  const na = (a ?? '').toLowerCase().trim();
  const nb = (b ?? '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ba = na.split(/[/\\]/).pop() || na;
  const bb = nb.split(/[/\\]/).pop() || nb;
  return ba === bb || ba.endsWith(bb) || bb.endsWith(ba);
}

/** Quote and order numbers are 10 digits, shown as #1326379573. */
/** Short public id for quote and order URLs. Old UUID links still open. */
export function orderSlug(ref?: string | null, id?: string | null): string {
  const digits = (ref ?? '').replace(/\D/g, '');
  if (/^\d{6,12}$/.test(digits)) return digits;
  return id ?? '';
}

const DESIGN_NAME_LIMIT = 42;

/** Joined design names stay on one line. Extra names end with an ellipsis. */
export function clipDesignLabel(name: string) {
  const full = name.trim();
  const parts = full.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return { text: full, full };
  let text = '';
  for (const part of parts) {
    const next = text ? `${text} / ${part}` : part;
    if (next.length > DESIGN_NAME_LIMIT) {
      return {
        text: `${text || part.slice(0, DESIGN_NAME_LIMIT).trimEnd()}…`,
        full: parts.join(' / '),
      };
    }
    text = next;
  }
  return { text, full: parts.join(' / ') };
}

export function orderNumber(ref?: string | null, fallback?: string | null): string {
  const digits = (ref ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `#${digits}`;
  if (!ref?.trim() && fallback) return fallback;
  if (digits) return `#${digits}`;
  return fallback ?? '';
}

export function money(cents: number | null | undefined, currency = 'USD'): string {
  if (cents == null) return '-';
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Shared order status labels (production / billing states). */
const STATUS_LABEL: Record<OrderStatus, string> = {
  CREATED: 'Created',
  WAITING_FOR_QUOTATION: 'Waiting for quote',
  QUOTATION_PROVIDED: 'Quote provided',
  CLIENT_REJECTED_QUOTATION: 'Quote declined',
  WAITING_FOR_ADMIN_QUOTATION_APPROVAL: 'Counter pending',
  PENDING_PAYMENT: 'Pending payment',
  IN_PROGRESS: 'In progress',
  READY_TO_SEND: 'Ready to send',
  REVISION_REQUESTED: 'Revision requested',
  COMPLETED: 'Delivered',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

export type StatusAudience = 'admin' | 'customer' | 'shared';

export type StatusChip = { cls: string; label: string };

/**
 * Canonical status labels so admin and customer see the same lifecycle
 * (wording may differ by audience, meaning never diverges).
 */
export function statusLabel(
  status: OrderStatus | string | null | undefined,
  audience: StatusAudience = 'shared',
): string {
  if (!status) return '';
  const chip = lifecycleChip(status as OrderStatus, audience);
  if (chip) return chip.label;
  return STATUS_LABEL[status as OrderStatus] ?? String(status).replace(/_/g, ' ');
}

export function statusChipClass(status: OrderStatus | string | null | undefined): string {
  if (!status) return 'chip c-prog';
  const chip = lifecycleChip(status as OrderStatus, 'shared');
  if (chip) return chip.cls;
  switch (status) {
    case 'COMPLETED':
      return 'chip c-done';
    case 'IN_PROGRESS':
    case 'READY_TO_SEND':
      return 'chip c-prog';
    case 'WAITING_FOR_QUOTATION':
    case 'CREATED':
      return 'chip c-new';
    case 'QUOTATION_PROVIDED':
    case 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL':
      return 'chip c-quote';
    case 'REJECTED':
    case 'CANCELLED':
    case 'CLIENT_REJECTED_QUOTATION':
      return 'chip c-wait';
    default:
      return 'chip c-prog';
  }
}

/** Quote lifecycle chip used by admin + portal lists/details. */
export function lifecycleChip(
  status: OrderStatus | string,
  audience: StatusAudience = 'shared',
  opts?: {
    partiallyAccepted?: boolean;
    partiallyDelivered?: boolean;
    fullyDelivered?: boolean;
    revisionPartial?: boolean;
    paymentStatus?: string | null;
  },
): StatusChip {
  const isAdmin = audience === 'admin';
  const isCustomer = audience === 'customer';

  switch (status) {
    case 'CREATED':
      return {
        cls: isAdmin ? 'chip c-quote' : 'chip c-new',
        label: isAdmin ? 'Needs your price' : 'Draft',
      };
    case 'WAITING_FOR_QUOTATION':
      return {
        cls: 'chip c-quote',
        label: isCustomer ? 'Being priced' : isAdmin ? 'Needs your price' : 'Waiting for quote',
      };
    case 'QUOTATION_PROVIDED':
      return {
        cls: 'chip c-prog',
        label: isCustomer ? 'Quote ready' : isAdmin ? 'Awaiting customer' : 'Quote provided',
      };
    case 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL':
      return { cls: 'chip c-quote', label: 'Counter pending' };
    case 'CLIENT_REJECTED_QUOTATION':
      return {
        cls: 'chip c-wait',
        label: isCustomer ? 'Declined' : isAdmin ? 'Declined by customer' : 'Quote declined',
      };
    case 'REJECTED':
      return {
        cls: 'chip c-wait',
        label: isCustomer ? 'Declined by studio' : isAdmin ? 'Declined by staff' : 'Rejected',
      };
    case 'CANCELLED':
      return { cls: 'chip c-wait', label: isCustomer ? 'Cancelled' : 'Cancelled' };
    case 'PENDING_PAYMENT':
      return { cls: 'chip c-wait', label: 'Pending payment' };
    case 'IN_PROGRESS':
    case 'READY_TO_SEND':
    case 'REVISION_REQUESTED':
      if (status === 'REVISION_REQUESTED') {
        if (opts?.revisionPartial) {
          return { cls: 'chip c-prog', label: 'Partially delivered' };
        }
        return { cls: 'chip c-wait', label: 'Revision requested' };
      }
      if (opts?.fullyDelivered) {
        return { cls: 'chip c-done', label: 'Delivered' };
      }
      if (opts?.partiallyDelivered) {
        return { cls: 'chip c-prog', label: 'Partially delivered' };
      }
      if (opts?.partiallyAccepted) {
        return { cls: 'chip c-done', label: 'Partially accepted' };
      }
      if (status === 'READY_TO_SEND') return { cls: 'chip c-prog', label: 'Ready to send' };
      return {
        cls: 'chip c-done',
        label: isCustomer
          ? opts?.paymentStatus === 'PAID'
            ? 'Paid · In Progress'
            : 'In Progress'
          : isAdmin
            ? 'Accepted, in progress'
            : 'In progress',
      };
    case 'COMPLETED':
    case 'CLOSED':
      return { cls: 'chip c-done', label: 'Delivered' };
    case 'REFUNDED':
      return { cls: 'chip c-wait', label: 'Refunded' };
    default:
      return {
        cls: 'chip c-prog',
        label: STATUS_LABEL[status as OrderStatus] ?? String(status).replace(/_/g, ' '),
      };
  }
}

export function paymentChip(status: OrderPaymentStatus | null | undefined): StatusChip {
  switch (status) {
    case 'PAID':
      return { cls: 'chip c-paid', label: 'Paid' };
    case 'AWAITING':
      return { cls: 'chip c-wait', label: 'Awaiting payment' };
    case 'REFUNDED':
      return { cls: 'chip c-unpaid', label: 'Refunded' };
    case 'UNPAID':
    default:
      return { cls: 'chip c-unpaid', label: 'Unpaid' };
  }
}

export function quoteLifecycleChip(
  status: OrderStatus | string,
  audience: StatusAudience,
  opts?: {
    partiallyAccepted?: boolean;
    adminRecounter?: boolean;
    needsCustomerInfo?: boolean;
    createdAt?: string | null;
    type?: string;
  },
): StatusChip {
  if (audience === 'customer') {
    if (opts?.type === 'ORDER') {
      return { cls: 'portal-chip c-delivered', label: 'Approved' };
    }
    if (opts?.needsCustomerInfo) {
      return { cls: 'portal-chip c-review', label: 'Info Needed' };
    }
    if (status === 'QUOTATION_PROVIDED' && isQuoteExpired(opts?.createdAt)) {
      return { cls: 'portal-chip c-cancelled', label: 'Expired' };
    }
    if (status === 'CREATED') return { cls: 'portal-chip c-progress', label: 'Draft' };
    if (status === 'WAITING_FOR_QUOTATION') {
      return { cls: 'portal-chip c-progress', label: 'Submitted' };
    }
    if (status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL') {
      return { cls: 'portal-chip c-progress', label: 'Quote in Progress' };
    }
    if (status === 'QUOTATION_PROVIDED') {
      return {
        cls: 'portal-chip c-review',
        label: opts?.adminRecounter ? 'Updated quote' : 'Ready for Approval',
      };
    }
    if (status === 'CLIENT_REJECTED_QUOTATION' || status === 'REJECTED') {
      return { cls: 'portal-chip c-cancelled', label: 'Declined' };
    }
    if (status === 'CANCELLED') return { cls: 'portal-chip c-cancelled', label: 'Cancelled' };
  }
  if (status === 'QUOTATION_PROVIDED' && opts?.adminRecounter) {
    return {
      cls: 'chip c-quote',
      label: 'Updated quote sent',
    };
  }
  return lifecycleChip(status, audience, opts);
}

export function isQuoteExpired(createdAt?: string | null) {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > 30 * 24 * 60 * 60 * 1000;
}

type RevisionEdit = {
  status: string;
  createdAt: string;
  resolvedAt?: string | null;
  designIds?: string[];
  designId?: string | null;
};

function revisionDesignIds(edit: RevisionEdit) {
  if (edit.designIds && edit.designIds.length > 0) return edit.designIds;
  return edit.designId ? [edit.designId] : [];
}

/** Open revision with none, some, or all of its designs delivered again. */
export function revisionDeliveryState(
  edits: RevisionEdit[],
  designStatus: (id: string) => string | null | undefined,
): 'revision' | 'partial' | null {
  const pending = edits.filter((edit) => edit.status === 'PENDING');
  if (pending.length === 0) return null;
  const cycleStart = Math.min(...pending.map((edit) => new Date(edit.createdAt).getTime()));
  const relevant = edits.filter((edit) => {
    if (edit.status === 'PENDING') return true;
    if (edit.status !== 'DONE' || !edit.resolvedAt) return false;
    return new Date(edit.resolvedAt).getTime() >= cycleStart;
  });
  const ids = [...new Set(relevant.flatMap(revisionDesignIds))];
  if (ids.length === 0) return 'revision';
  const delivered = ids.filter((id) => designStatus(id) === 'DELIVERED').length;
  if (delivered > 0 && delivered < ids.length) return 'partial';
  return 'revision';
}

export function customerOrderChip(o: {
  status: OrderStatus | string;
  partiallyDelivered?: boolean;
  fullyDelivered?: boolean;
  revisionPartial?: boolean;
}): StatusChip {
  if (o.status === 'CANCELLED') return { cls: 'portal-chip c-cancelled', label: 'Cancelled' };
  if (o.status === 'COMPLETED' || o.status === 'CLOSED') {
    return { cls: 'portal-chip c-delivered', label: 'Delivered' };
  }
  if (o.status === 'REVISION_REQUESTED') {
    if (o.revisionPartial) {
      return { cls: 'portal-chip c-review', label: 'Partially delivered' };
    }
    return { cls: 'portal-chip c-revision', label: 'Revision Requested' };
  }
  if (o.fullyDelivered) {
    return { cls: 'portal-chip c-delivered', label: 'Delivered' };
  }
  if (o.partiallyDelivered) {
    return { cls: 'portal-chip c-review', label: 'Partially delivered' };
  }
  if (o.status === 'READY_TO_SEND') {
    return { cls: 'portal-chip c-review', label: 'Ready for Review' };
  }
  return { cls: 'portal-chip c-progress', label: 'In Progress' };
}

export function mergeDeliveredVia(
  vias: Array<string | null | undefined>,
): 'PORTAL' | 'EMAIL' | 'BOTH' | null {
  const set = new Set(vias.filter(Boolean));
  const emailed = set.has('EMAIL') || set.has('BOTH');
  const portal = set.has('PORTAL') || set.has('BOTH');
  if (emailed && portal) return 'BOTH';
  if (emailed) return 'EMAIL';
  if (portal) return 'PORTAL';
  return null;
}

export function deliveredViaFromFlags(
  hasPortalFiles: boolean,
  emailed: boolean,
): 'PORTAL' | 'EMAIL' | 'BOTH' {
  if (emailed && hasPortalFiles) return 'BOTH';
  if (emailed) return 'EMAIL';
  return 'PORTAL';
}

export function orderDeliveredVia(order: {
  deliveredVia?: string | null;
  deliveries?: Array<{
    deliveredVia?: string | null;
    releasedAt?: string | null;
    kind?: string | null;
  }>;
}): string | null {
  const fromDeliveries = mergeDeliveredVia(
    (order.deliveries ?? [])
      .filter((d) => d.releasedAt && d.kind !== 'PREVIEW')
      .map((d) => d.deliveredVia),
  );
  return fromDeliveries ?? order.deliveredVia ?? null;
}

export function deliveryMethodLabel(via?: string | null): string {
  if (via === 'BOTH') return 'Files delivered by email and on portal';
  if (via === 'EMAIL') return 'Files delivered by email';
  if (via === 'PORTAL') return 'Files delivered on portal';
  return 'Not delivered';
}

/** Per-design status after files are published. */
export function designDeliveredLabel(
  deliveries: Array<{
    deliveredVia?: string | null;
    releasedAt?: string | null;
    kind?: string | null;
    files?: Array<{ designId?: string | null; originalName?: string; isBundle?: boolean }>;
  }> | null | undefined,
  designId: string | null | undefined,
): string {
  const batches = (deliveries ?? []).filter(
    (batch) => batch.releasedAt && batch.kind !== 'PREVIEW',
  );
  const linked = designId
    ? batches.filter((batch) =>
        (batch.files ?? []).some(
          (file) =>
            file.designId === designId &&
            !/^delivered by email$/i.test(file.originalName ?? ''),
        ),
      )
    : [];
  const via = mergeDeliveredVia(linked.map((batch) => batch.deliveredVia));
  if (via === 'BOTH') return 'Delivered on portal & through email';
  if (via === 'EMAIL') return 'Delivered through email';
  if (via === 'PORTAL') return 'Delivered on portal';
  return 'Delivered through email';
}
