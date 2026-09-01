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
  const base = extOk ? trimmed.slice(0, lastDot) : trimmed;
  const generated = base.length >= 36 && /^[A-Za-z0-9_-]+$/.test(base);

  if (generated) {
    const lower = extOk ? ext.toLowerCase() : '';
    if (IMAGE_EXTS.has(lower)) return 'Reference image';
    if (lower === 'pdf') return 'Reference PDF';
    return extOk ? `Reference file (.${lower})` : 'Reference file';
  }

  return trimmed;
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
  opts?: { partiallyAccepted?: boolean; partiallyDelivered?: boolean },
): StatusChip {
  const isAdmin = audience === 'admin';
  const isCustomer = audience === 'customer';

  switch (status) {
    case 'CREATED':
      return { cls: 'chip c-new', label: 'Draft' };
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
      return { cls: 'chip c-wait', label: 'Expired' };
    case 'PENDING_PAYMENT':
      return { cls: 'chip c-wait', label: 'Pending payment' };
    case 'IN_PROGRESS':
    case 'READY_TO_SEND':
    case 'REVISION_REQUESTED':
      if (opts?.partiallyDelivered) {
        return { cls: 'chip c-prog', label: 'Partially delivered' };
      }
      if (opts?.partiallyAccepted) {
        return { cls: 'chip c-done', label: 'Partially accepted' };
      }
      if (status === 'READY_TO_SEND') return { cls: 'chip c-prog', label: 'Ready to send' };
      if (status === 'REVISION_REQUESTED') {
        return { cls: 'chip c-wait', label: 'Revision requested' };
      }
      return {
        cls: 'chip c-done',
        label: isAdmin || isCustomer ? 'Accepted, in progress' : 'In progress',
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
  opts?: { partiallyAccepted?: boolean; adminRecounter?: boolean },
): StatusChip {
  if (status === 'QUOTATION_PROVIDED' && opts?.adminRecounter) {
    const isCustomer = audience === 'customer';
    return {
      cls: 'chip c-quote',
      label: isCustomer ? 'Re-counter from admin' : 'Re-counter sent',
    };
  }
  return lifecycleChip(status, audience, opts);
}
