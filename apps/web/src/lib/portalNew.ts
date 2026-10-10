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

export const ACCOUNT_APPROVED_TITLE = 'Account approved';
export const ACCOUNT_WELCOME_BODY =
  'Welcome to Las Vegas Designs! Your account is ready. Complete your profile, personalize your portal colors, or submit your first quote request.';

export function isAccountApprovedNotice(title: string, link?: string | null) {
  const t = title.toLowerCase();
  const href = (link ?? '').toLowerCase();
  return t === 'account approved' || href === '/login';
}

export function displayActivityBody(title: string, body: string | null, link?: string | null) {
  if (isAccountApprovedNotice(title, link)) return ACCOUNT_WELCOME_BODY;
  return body;
}

export function portalActivityAction(title: string, link: string | null) {
  if (isAccountApprovedNotice(title, link)) return null;
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

export type ActivityTone = 'amber' | 'red' | 'green' | 'slate';

export function portalActivityRow(title: string, link: string | null): {
  update: string;
  tone: ActivityTone;
  actionLabel: string | null;
  to: string | null;
  primary: boolean;
} {
  const t = title.toLowerCase();
  const dest = portalActivityAction(title, link);
  if (t.includes('message')) {
    return {
      update: 'New message',
      tone: 'amber',
      actionLabel: 'Reply',
      to: dest?.to ?? link,
      primary: true,
    };
  }
  if (t.includes('payment received') || t.includes('partial payment')) {
    return {
      update: t.includes('partial') ? 'Partial payment' : 'Payment received',
      tone: 'green',
      actionLabel: 'View receipt',
      to: dest?.to ?? '/portal/invoices',
      primary: false,
    };
  }
  if (t.includes('revision started') || t.includes('revision requested')) {
    return {
      update: 'Revision started',
      tone: 'slate',
      actionLabel: 'View revision',
      to: dest?.to ?? link,
      primary: false,
    };
  }
  if (t.includes('revised') && (t.includes('file') || t.includes('ready'))) {
    return {
      update: 'Revised files ready',
      tone: 'green',
      actionLabel: 'Download files',
      to: dest?.to ?? filesSectionPath(link),
      primary: false,
    };
  }
  if (
    t.includes('invoice') ||
    t.includes('ready to pay') ||
    t.includes('payment reminder') ||
    t.includes('revision payment') ||
    t.includes('price updated')
  ) {
    return {
      update: 'Invoice ready',
      tone: 'red',
      actionLabel: 'Pay now',
      to: dest?.to ?? '/portal/invoices',
      primary: true,
    };
  }
  if (t.includes('quote') || t.includes('quotation')) {
    const declined = t.includes('declin') || t.includes('reject');
    return {
      update: declined ? 'Quote declined' : t.includes('updated') ? 'Quote updated' : 'Quote ready',
      tone: declined ? 'red' : 'amber',
      actionLabel: declined ? 'View quote' : 'Review quote',
      to: dest?.to ?? '/portal/quotes',
      primary: !declined,
    };
  }
  if (t.includes('preview')) {
    return {
      update: 'Preview ready',
      tone: 'green',
      actionLabel: 'View preview',
      to: dest?.to ?? link,
      primary: false,
    };
  }
  if (t.includes('file') || t.includes('deliver')) {
    return {
      update: 'Files ready',
      tone: 'green',
      actionLabel: 'Download files',
      to: dest?.to ?? filesSectionPath(link),
      primary: false,
    };
  }
  if (t.includes('started') || t.includes('now an order')) {
    return {
      update: 'Order started',
      tone: 'slate',
      actionLabel: 'View order',
      to: dest?.to ?? link,
      primary: false,
    };
  }
  return {
    update: title,
    tone: 'slate',
    actionLabel: dest?.label ?? null,
    to: dest?.to ?? null,
    primary: false,
  };
}
