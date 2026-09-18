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

function orderIdFromLink(link: string | null) {
  return link?.match(/\/orders\/([^/?#]+)/)?.[1] ?? null;
}

export function filesSectionPath(link: string | null) {
  const orderId = orderIdFromLink(link);
  return orderId ? `/portal/files?order=${orderId}` : '/portal/files';
}

export function portalActivityAction(title: string, link: string | null) {
  const t = title.toLowerCase();
  if (t.includes('quote')) return { label: 'Review quote', to: link || '/portal/quotes' };
  if (t.includes('deliver') || t.includes('file')) {
    return { label: 'View files', to: filesSectionPath(link) };
  }
  if (t.includes('invoice') || t.includes('payment')) {
    return { label: 'View invoice', to: link || '/portal/invoices' };
  }
  if (link) return { label: 'View', to: link };
  return null;
}
