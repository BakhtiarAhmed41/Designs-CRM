import type { QuotationLine } from './designs';
import type { Quotation, UserRole } from './types';
import { STAFF_ROLES } from './types';

export function isStaffCreatedOrder(order?: { createdByRole?: UserRole | null } | null) {
  return Boolean(order?.createdByRole && STAFF_ROLES.includes(order.createdByRole));
}

export type QuoteWithLines = Quotation & { lines?: QuotationLine[] };

type PricingOrder = {
  type?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  createdByRole?: UserRole | null;
};

/** A staff-created order sits as a draft until an admin enters the prices. */
export function needsOrderPricing(order?: PricingOrder | null) {
  return order?.type === 'ORDER' && order?.status === 'CREATED';
}

/** Prices stay editable until the customer has paid. */
export function canPriceOrder(order?: PricingOrder | null) {
  if (order?.type !== 'ORDER') return false;
  if (order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED') return false;
  if (needsOrderPricing(order)) return true;
  return order.status === 'PENDING_PAYMENT' && isStaffCreatedOrder(order);
}

function byVersionDesc(a: QuoteWithLines, b: QuoteWithLines) {
  return b.version - a.version;
}

/** Latest quote written by staff, preferring the one the customer should act on. */
export function studioQuotation(
  quotations?: QuoteWithLines[] | null,
): QuoteWithLines | undefined {
  const list = [...(quotations ?? [])].sort(byVersionDesc);
  const studio = list.filter((q) => q.createdByRole !== 'CLIENT');
  return (
    studio.find((q) => q.status === 'PROPOSED' || q.status === 'APPROVED') ??
    studio[0]
  );
}

export function latestCounter(
  quotations?: QuoteWithLines[] | null,
): QuoteWithLines | undefined {
  const list = [...(quotations ?? [])].sort(byVersionDesc);
  return list.find(
    (q) => q.createdByRole === 'CLIENT' || q.status === 'COUNTERED',
  );
}

/** Latest staff quote after the customer has already sent a counter. */
export function isAdminRecounter(
  quotations?: QuoteWithLines[] | null,
): boolean {
  const list = [...(quotations ?? [])].sort(byVersionDesc);
  const latest = list[0];
  if (!latest || latest.createdByRole === 'CLIENT') return false;
  return list.some((q) => q.createdByRole === 'CLIENT');
}

export function quoteHistoryLabel(
  q: QuoteWithLines,
  all: QuoteWithLines[],
): string {
  if (q.createdByRole === 'CLIENT') return 'Customer counter';
  const earlierStaffQuote = all.some(
    (other) => other.createdByRole !== 'CLIENT' && other.version < q.version,
  );
  return earlierStaffQuote ? 'Revised Quote' : 'Original Quote';
}

export function lineTotal(l: QuotationLine) {
  return (l.priceCents ?? 0) + l.sizes.reduce((s, sz) => s + (sz.priceCents ?? 0), 0);
}
