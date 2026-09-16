import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, LogoutLink, Shell, useShellUser } from './Shell';
import { getMyCustomer, portalLookFromPrefs } from '@/lib/customers';
import { listMyOrderSummary } from '@/lib/orders';
import { getMyInvoiceSummary } from '@/lib/billing';
import { getMyUnreadSummary } from '@/lib/messaging';
import { listNotifications, markNotificationRead } from '@/lib/notifications';
import { unreadIdsForSection, unreadSections, type PortalNewSection } from '@/lib/portalNew';
import { whenVisible } from '@/lib/queryRefresh';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

type NavEntry = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: ReactNode;
};

function NavGroup({
  label,
  items,
  extra,
}: {
  label: string;
  items: NavEntry[];
  extra?: ReactNode;
}) {
  return (
    <>
      <p className="nav-label">{label}</p>
      <nav className="nav" aria-label={label}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'on' : undefined)}
          >
            <i className={`ti ${item.icon}`} /> {item.label} {item.badge}
          </NavLink>
        ))}
        {extra}
      </nav>
    </>
  );
}

function PoliciesMenu() {
  const { pathname } = useLocation();
  const onPolicies = pathname.startsWith('/portal/policies');
  const [open, setOpen] = useState(onPolicies);

  useEffect(() => {
    if (onPolicies) setOpen(true);
  }, [onPolicies]);

  return (
    <div className={`nav-drop${open ? ' open' : ''}`}>
      <button
        type="button"
        className={`nav-drop-btn${onPolicies ? ' on' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="ti ti-notes" />
        <span>Policies</span>
        <i className={`ti ti-chevron-down nav-drop-caret${open ? ' up' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="nav-drop-menu" aria-label="Policy pages">
          <NavLink
            to="/portal/policies/refund-store-credit-revision"
            className={({ isActive }) => (isActive ? 'on' : undefined)}
          >
            Refund, credit &amp; revisions
          </NavLink>
          <NavLink
            to="/portal/policies/summary"
            className={({ isActive }) => (isActive ? 'on' : undefined)}
          >
            Policy summary
          </NavLink>
        </div>
      )}
    </div>
  );
}

export function PortalShell() {
  const { onLogout } = useShellUser();
  const qc = useQueryClient();
  const location = useLocation();
  useMessagingSocket({
    onUnreadChanged: () => {
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
    },
    onMessageNew: () => {
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
    },
  });

  useQuery({
    queryKey: ['my-orders-summary'],
    queryFn: listMyOrderSummary,
  });
  useQuery({
    queryKey: ['portal-invoices-summary'],
    queryFn: getMyInvoiceSummary,
  });
  const { data: unread } = useQuery({
    queryKey: ['portal-unread'],
    queryFn: getMyUnreadSummary,
    refetchInterval: whenVisible(20_000),
  });
  const { data: meCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const { data: activityData } = useQuery({
    queryKey: ['my-activity', 'nav'],
    queryFn: () => listNotifications({ page: 1, pageSize: 40 }),
    refetchInterval: whenVisible(20_000),
  });
  const look = portalLookFromPrefs(meCustomer?.customer?.preferences);
  const notes = activityData?.notifications ?? [];
  const news = unreadSections(notes);
  const msgUnread = (unread?.unreadConversations ?? 0) > 0;

  useEffect(() => {
    const path = location.pathname;
    const section: PortalNewSection | null =
      path.startsWith('/portal/quotes/new')
        ? null
        : path.startsWith('/portal/quotes')
          ? 'quotes'
          : path.startsWith('/portal/orders')
            ? 'orders'
            : path.startsWith('/portal/invoices')
              ? 'invoices'
              : null;
    if (!section) return;
    const ids = unreadIdsForSection(notes, section);
    if (ids.length === 0) return;
    void Promise.all(ids.map((id) => markNotificationRead(id))).then(() => {
      void qc.invalidateQueries({ queryKey: ['my-activity'] });
    });
  }, [location.pathname, notes, qc]);

  const newBadge = (section: PortalNewSection, label: string) =>
    news.has(section) ? (
      <span className="nav-new" aria-label={`New ${label}`}>
        NEW
      </span>
    ) : null;

  const main: NavEntry[] = [
    { to: '/portal', label: 'Dashboard', icon: 'ti-layout-dashboard', end: true },
    {
      to: '/portal/messages',
      label: 'Messages',
      icon: 'ti-message',
      badge: msgUnread ? <span className="dot" aria-label="Unread messages" /> : null,
    },
  ];
  const projects: NavEntry[] = [
    {
      to: '/portal/quotes',
      label: 'Quotes',
      icon: 'ti-file-invoice',
      badge: newBadge('quotes', 'quotes'),
    },
    {
      to: '/portal/orders',
      label: 'Orders',
      icon: 'ti-package',
      badge: newBadge('orders', 'orders'),
    },
    {
      to: '/portal/files',
      label: 'My Files',
      icon: 'ti-folder',
      badge: newBadge('files', 'files'),
    },
  ];
  const billing: NavEntry[] = [
    {
      to: '/portal/invoices',
      label: 'Invoices',
      icon: 'ti-receipt',
      badge: newBadge('invoices', 'invoices'),
    },
  ];
  const account: NavEntry[] = [
    { to: '/portal/profile', label: 'Profile', icon: 'ti-user' },
    { to: '/portal/settings', label: 'Settings', icon: 'ti-settings' },
  ];
  const sidebar = (
    <aside className="side portal-side">
      <Brand subtitle="Customer portal" />
      <NavGroup label="Main" items={main} />
      <NavGroup label="My Projects" items={projects} />
      <NavGroup label="Billing" items={billing} />
      <p className="nav-label">Request a quote</p>
      <nav className="service-nav" aria-label="Quote services">
        <NavLink to="/portal/quotes/new?service=embroidery" className={() => undefined}>
          <i className="ti ti-needle-thread" /> Embroidery Digitizing
        </NavLink>
        <NavLink to="/portal/quotes/new?service=vector" className={() => undefined}>
          <i className="ti ti-vector-bezier" /> Vector &amp; Print Artwork
        </NavLink>
        <NavLink to="/portal/quotes/new?service=laser" className={() => undefined}>
          <i className="ti ti-router" /> Cutting &amp; Engraving Files
        </NavLink>
      </nav>
      <NavGroup label="Account" items={account} extra={<PoliciesMenu />} />
      <div className="foot">
        <LogoutLink onClick={() => void onLogout()} />
      </div>
    </aside>
  );

  return (
    <div
      className="portal-look"
      style={{
        ['--portal-heading' as string]: look.headingColor || undefined,
        ['--portal-page-bg' as string]: look.backgroundColor || undefined,
      }}
    >
    <Shell
      sidebar={sidebar}
      brandLabel="Customer portal"
      contextLabel="Customer"
      mobileItems={[
        { to: '/portal', label: 'Home', icon: 'ti-layout-dashboard', end: true },
        { to: '/portal/quotes', label: 'Quotes', icon: 'ti-file-invoice' },
        { to: '/portal/orders', label: 'Orders', icon: 'ti-package' },
        { to: '/portal/messages', label: 'Chat', icon: 'ti-message' },
      ]}
    />
    </div>
  );
}
