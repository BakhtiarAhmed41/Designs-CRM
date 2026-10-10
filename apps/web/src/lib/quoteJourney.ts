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

/** Date and total line under the staff quote stepper. */
export function staffJourneyLines(input: {
  phase: Exclude<QuoteJourneyPhase, 'closed'>;
  revised?: boolean;
  version?: number | null;
  sentAt?: string | null;
  paidAt?: string | null;
  totalLabel?: string | null;
}) {
  const { phase, revised, version, sentAt, paidAt, totalLabel } = input;
  if (phase === 'review') {
    const bits = [
      sentAt ? `Sent ${sentAt}` : null,
      revised && version ? `Version ${version}` : null,
      totalLabel ? `Quote total: ${totalLabel}` : null,
    ].filter(Boolean);
    return { subtitle: bits.join(' · ') || undefined };
  }
  if (phase === 'pay') {
    return { subtitle: totalLabel ? `Quote total: ${totalLabel}` : undefined };
  }
  if (phase === 'paid' || phase === 'accepted') {
    const bits = [
      paidAt ? `Paid ${paidAt}` : null,
      version ? `Version ${version}` : null,
    ].filter(Boolean);
    return {
      subtitle: 'This quote has been converted to an order.',
      meta: bits.join(' · ') || undefined,
    };
  }
  return {};
}
