import type { OrderStatus } from './types';

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

const STATUS_LABEL: Record<OrderStatus, string> = {
  CREATED: 'Created',
  WAITING_FOR_QUOTATION: 'Waiting for quote',
  QUOTATION_PROVIDED: 'Quote provided',
  CLIENT_REJECTED_QUOTATION: 'Quote rejected',
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

export function statusLabel(status: OrderStatus): string {
  return STATUS_LABEL[status] ?? status;
}

export function statusChipClass(status: OrderStatus): string {
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
