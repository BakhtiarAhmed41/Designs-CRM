export type QuoteJourneyPhase =
  | 'preparing'
  | 'review'
  | 'pay'
  | 'paid'
  | 'accepted'
  | 'closed';

const CLOSED = new Set([
  'REJECTED',
  'CLIENT_REJECTED_QUOTATION',
  'CANCELLED',
  'REFUNDED',
]);

/** Which quote stepper to show for this request. */
export function quoteJourneyPhase(order: {
  type?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
}): QuoteJourneyPhase {
  const status = order.status ?? '';
  if (CLOSED.has(status) || order.paymentStatus === 'REFUNDED') return 'closed';

  if (order.type === 'ORDER') {
    if (order.paymentStatus === 'PAID') return 'paid';
    if (status === 'PENDING_PAYMENT' || order.paymentStatus === 'AWAITING') return 'pay';
    if (status === 'CREATED') return 'preparing';
    return 'accepted';
  }

  if (
    status === 'QUOTATION_PROVIDED' ||
    status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL'
  ) {
    return 'review';
  }

  return 'preparing';
}
