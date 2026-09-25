import type { Design, QuotationLine } from './designs';
import { designOptionLabel, embroideryDesigns, groupQuoteLines } from './embroideryQuote';
import { lineTotal } from './quoteHelpers';
import type { Order } from './types';

export type DeliveryRow = {
  key: string;
  name: string;
  priceCents: number;
  design?: Design;
};

export type DeliveryGroup = {
  title: string;
  rows: DeliveryRow[];
};

type OrderWithDesigns = Order & { designs?: Design[] };

export function orderDeliveryGroups(
  order: OrderWithDesigns,
  lines: QuotationLine[],
): DeliveryGroup[] {
  const pool = [...(order.designs ?? [])];
  const kept = lines.filter((line) => line.clientDecision !== 'DROPPED');
  const labels = embroideryDesigns(order.preferences, order.name).map((design, index) =>
    designOptionLabel(index, design.name).replace(' - ', ' · '),
  );
  const take = (name: string) => {
    const index = pool.findIndex((design) => design.name === name);
    if (index < 0) return undefined;
    return pool.splice(index, 1)[0];
  };
  if (kept.length > 0) {
    return groupQuoteLines(kept, labels)
      .map((group) => ({
        title: group.title,
        rows: group.lines.map((line) => ({
          key: line.id,
          name: line.name,
          priceCents: lineTotal(line),
          design: take(line.name),
        })),
      }))
      .filter((group) => group.rows.length);
  }
  const designs = order.designs ?? [];
  if (designs.length === 0) return [];
  return [
    {
      title: order.name?.trim() || 'Order',
      rows: designs.map((design) => ({
        key: design.id,
        name: design.name,
        priceCents: design.priceCents ?? 0,
        design,
      })),
    },
  ];
}

export function deliveryCounts(groups: DeliveryGroup[]) {
  const rows = groups.flatMap((group) => group.rows);
  const delivered = rows.filter((row) => row.design?.status === 'DELIVERED').length;
  return { total: rows.length, delivered, allDelivered: rows.length > 0 && delivered === rows.length };
}
