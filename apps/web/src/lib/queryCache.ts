import type { QueryClient } from '@tanstack/react-query';
import type { Order } from './types';

/** First key of every screen that shows order / quote / money state. */
const WORK_QUERY_ROOTS = new Set([
  'admin-order',
  'admin-orders',
  'admin-orders-latest',
  'admin-order-activity',
  'admin-order-edits',
  'admin-mywork',
  'admin-dashboard-stats',
  'admin-dashboard-chart',
  'admin-quotes',
  'admin-quotes-to-price',
  'admin-quotes-followups',
  'admin-edits',
  'admin-edits-pending',
  'admin-format-requests',
  'my-order',
  'my-order-edits',
  'my-orders',
  'my-orders-summary',
  'my-quotes',
  'my-files',
  'my-invoices',
  'portal-orders-nav',
  'portal-invoices-summary',
  'billing-summary',
  'admin-invoices-all',
  'admin-invoices-order',
  'global-search',
  'pay-link',
  'admin-customers',
  'admin-team',
  'my-quote-drafts',
]);

const LIST_ROOTS = [
  'admin-orders',
  'admin-orders-latest',
  'admin-quotes',
  'admin-quotes-to-price',
  'admin-quotes-followups',
  'admin-mywork',
  'my-orders',
  'my-quotes',
] as const;

type OrderEnvelope = { order: Order };

function mergeOrder(prev: unknown, order: Order): OrderEnvelope {
  if (prev && typeof prev === 'object' && 'order' in prev) {
    const current = (prev as OrderEnvelope).order;
    return { ...(prev as object), order: { ...current, ...order } } as OrderEnvelope;
  }
  return { order };
}

function patchLists(qc: QueryClient, order: Order) {
  for (const root of LIST_ROOTS) {
    qc.setQueriesData({ queryKey: [root] }, (prev: unknown) => {
      if (!prev || typeof prev !== 'object') return prev;
      const data = prev as { orders?: Array<{ id: string }> };
      if (!Array.isArray(data.orders)) return prev;
      return {
        ...data,
        orders: data.orders.map((row) =>
          row.id === order.id ? { ...row, ...order } : row,
        ),
      };
    });
  }
}

/** Write the latest order into every open detail/list cache so buttons and chips update now. */
export function cacheOrder(qc: QueryClient, order: Order) {
  qc.setQueryData(['admin-order', order.id], (prev) => mergeOrder(prev, order));
  qc.setQueryData(['my-order', order.id], (prev) => mergeOrder(prev, order));
  patchLists(qc, order);
}

/** Mark every work screen stale so the next visit (or an open one) refetches. */
export function invalidateWorkCaches(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === 'string' && WORK_QUERY_ROOTS.has(query.queryKey[0]),
  });
}

export async function applyOrderChange(qc: QueryClient, order?: Order) {
  if (order) {
    await qc.cancelQueries({ queryKey: ['admin-order', order.id] });
    await qc.cancelQueries({ queryKey: ['my-order', order.id] });
    cacheOrder(qc, order);
  }
  return invalidateWorkCaches(qc);
}
