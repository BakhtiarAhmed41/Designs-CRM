import type { Notification } from './types';

export type PortalNewSection = 'quotes' | 'orders' | 'files' | 'invoices';

export function sectionForNotification(
  title: string,
  link: string | null,
): PortalNewSection | null {
  const t = title.toLowerCase();
  const href = (link ?? '').toLowerCase();
  if (t.includes('invoice') || t.includes('payment') || href.includes('/invoices')) {
    return 'invoices';
  }
  if (t.includes('quote') || t.includes('quotation') || href.includes('/quotes')) {
    return 'quotes';
  }
  if (t.includes('file') || t.includes('download') || href.includes('/files')) {
    return 'files';
  }
  if (t.includes('preview') || t.includes('order') || href.includes('/orders')) {
    return 'orders';
  }
  return null;
}

export function unreadSections(notifications: Notification[]): Set<PortalNewSection> {
  const next = new Set<PortalNewSection>();
  for (const n of notifications) {
    if (n.readAt) continue;
    const section = sectionForNotification(n.title, n.link);
    if (section) next.add(section);
  }
  return next;
}

export function unreadIdsForSection(
  notifications: Notification[],
  section: PortalNewSection,
): string[] {
  return notifications
    .filter((n) => !n.readAt && sectionForNotification(n.title, n.link) === section)
    .map((n) => n.id);
}
