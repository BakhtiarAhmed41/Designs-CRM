type Activity = {
  id: string;
  title: string;
  orderId: string | null;
  humanRef: string | null;
  readAt: Date | null;
  createdAt: Date;
  completedAt?: Date | null;
  completionLabel?: string | null;
  requiresAction?: boolean;
  invoiceId?: string | null;
};

// Match the update types shown by the customer activity table.
export function activityType(title: string) {
  const t = title.toLowerCase().trim();
  if (t.includes('message')) return 'message';
  if (t.includes('payment received') || t.includes('partial payment')) {
    return t.includes('partial') ? 'partial-payment' : 'payment';
  }
  if (t.includes('revision started') || t.includes('revision requested')) return 'revision';
  if (t.includes('revision request sent')) return 'revision-request';
  if (t.includes('revised') && (t.includes('file') || t.includes('ready'))) return 'revised-files';
  if (['invoice', 'statement', 'ready to pay', 'payment reminder', 'revision payment', 'price updated'].some((s) => t.includes(s))) return 'invoice';
  if (t.includes('quote request sent') || t.includes('new quote request')) return 'quote-request';
  if (t.includes('quote') || t.includes('quotation')) {
    return t.includes('declin') || t.includes('reject') ? 'quote-declined' : t.includes('updated') ? 'quote-updated' : 'quote-ready';
  }
  if (t.includes('preview')) return 'preview';
  if (t.includes('file') || t.includes('deliver')) return 'files';
  if (t.includes('started') || t.includes('now an order')) return 'order-started';
  return t;
}

export function needsActivityAction(title: string) {
  return ['message', 'invoice', 'quote-ready', 'quote-updated', 'files', 'revised-files'].includes(activityType(title));
}

export function groupActivities<T extends Activity>(items: T[]) {
  const groups = new Map<string, T & { notificationIds: string[]; count: number }>();
  const sorted = [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
  for (const item of sorted) {
    const order = item.orderId || item.humanRef || item.invoiceId;
    // Account notices or unresolved links must never merge unrelated updates.
    const key = order ? JSON.stringify([order, activityType(item.title)]) : item.id;
    const group = groups.get(key);
    if (group) {
      group.notificationIds.push(item.id);
      group.count += 1;
      if (!item.readAt) group.readAt = null;
      if (!item.completedAt) {
        group.completedAt = null;
        group.completionLabel = null;
      }
    } else {
      groups.set(key, { ...item, notificationIds: [item.id], count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) =>
    Number(Boolean(b.requiresAction && !b.completedAt)) - Number(Boolean(a.requiresAction && !a.completedAt)) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id),
  );
}
