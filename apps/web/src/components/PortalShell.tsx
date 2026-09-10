import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, LogoutLink, Shell, useShellUser } from './Shell';
import { getMyCustomer, portalLookFromPrefs } from '@/lib/customers';
import { listMyOrderSummary } from '@/lib/orders';
import { getMyInvoiceSummary } from '@/lib/billing';
import { getMyUnreadSummary } from '@/lib/messaging';
import { whenVisible } from '@/lib/queryRefresh';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

type NavEntry = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: ReactNode;
};

function NavGroup({ label, items }: { label: string; items: NavEntry[] }) {
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
      </nav>
    </>
  );
}

export function PortalShell() {
  const { onLogout } = useShellUser();
  const qc = useQueryClient();
  useMessagingSocket({
    onUnreadChanged: () => {
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
    },
    onMessageNew: () => {
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
    },
  });

  const { data: quoteSummary } = useQuery({
    queryKey: ['my-orders-summary'],
    queryFn: listMyOrderSummary,
  });
  const { data: invoicesData } = useQuery({
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
  const look = portalLookFromPrefs(meCustomer?.customer?.preferences);
  const quoteCount = quoteSummary?.awaitingQuote ?? 0;
  const orderCount = quoteSummary?.activeOrders ?? 0;
  const invoiceCount = invoicesData?.awaitingCount ?? 0;
  const msgUnread = (unread?.unreadConversations ?? 0) > 0;

  const countBadge = (n: number, label: string) =>
    n > 0 ? (
      <span className="cnt" aria-label={`${n} ${label}`}>
        {n}
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
      badge: countBadge(quoteCount, 'quotes'),
    },
    {
      to: '/portal/orders',
      label: 'Orders',
      icon: 'ti-package',
      badge: countBadge(orderCount, 'active orders'),
    },
    { to: '/portal/files', label: 'My Files', icon: 'ti-folder' },
  ];
  const billing: NavEntry[] = [
    {
      to: '/portal/invoices',
      label: 'Invoices',
      icon: 'ti-receipt',
      badge: countBadge(invoiceCount, 'pending invoices'),
    },
  ];
  const account: NavEntry[] = [
    { to: '/portal/profile', label: 'Profile', icon: 'ti-user' },
    { to: '/portal/settings', label: 'Settings', icon: 'ti-settings' },
    { to: '/portal/policies', label: 'Policies', icon: 'ti-file-text' },
  ];

  const sidebar = (
    <aside className="side portal-side">
      <Brand subtitle="Customer portal" />
      <NavGroup label="Main" items={main} />
      <NavGroup label="My Projects" items={projects} />
      <NavGroup label="Billing" items={billing} />
      <p className="nav-label">Request a quote</p>
      <nav className="service-nav" aria-label="Quote services">
        <NavLink to="/portal/quotes/new?service=embroidery">
          <i className="ti ti-needle-thread" /> Embroidery Digitizing
        </NavLink>
        <NavLink to="/portal/quotes/new?service=vector">
          <i className="ti ti-vector-bezier" /> Vector &amp; Print
        </NavLink>
        <NavLink to="/portal/quotes/new?service=svg">
          <i className="ti ti-vector-triangle" /> SVG &amp; Cricut Files
        </NavLink>
        <NavLink to="/portal/quotes/new?service=laser">
          <i className="ti ti-router" /> CNC &amp; Laser Files
        </NavLink>
      </nav>
      <NavGroup label="Account" items={account} />
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
