import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, LogoutLink, Shell, useShellUser } from './Shell';
import { listMyOrderSummary } from '@/lib/orders';
import { listMyInvoices } from '@/lib/billing';
import { listMyConversations } from '@/lib/messaging';
import { getMyCustomer } from '@/lib/customers';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

type NavEntry = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: ReactNode;
};

export function PortalShell() {
  const { onLogout } = useShellUser();
  const qc = useQueryClient();
  useMessagingSocket({
    onUnreadChanged: () => {
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    },
    onMessageNew: () => {
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    },
  });

  const { data: quoteSummary } = useQuery({
    queryKey: ['my-orders-summary'],
    queryFn: listMyOrderSummary,
  });
  const { data: invoicesData } = useQuery({
    queryKey: ['portal-invoices-nav'],
    queryFn: listMyInvoices,
  });
  const { data: convos } = useQuery({
    queryKey: ['portal-convos-nav'],
    queryFn: listMyConversations,
    refetchInterval: 20_000,
  });
  const { data: meCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });

  const quoteCount = quoteSummary?.awaitingQuote ?? 0;
  const invoiceCount = (invoicesData?.invoices ?? []).filter(
    (i) => i.status === 'AWAITING',
  ).length;
  const msgUnread = (convos?.conversations ?? []).some((t) => (t.unreadClient ?? 0) > 0);

  const accountType = meCustomer?.customer?.accountType ?? 'PAY_PER_ORDER';
  const badgeLabel =
    accountType === 'NET_MONTHLY'
      ? meCustomer?.customer?.netTerms === 'NET_30'
        ? 'Net-30'
        : 'Net-monthly'
      : 'Pay per order';

  const items: NavEntry[] = [
    {
      to: '/portal',
      label: 'Dashboard',
      icon: 'ti-layout-dashboard',
      end: true,
    },
    {
      to: '/portal/quotes',
      label: 'Quotes',
      icon: 'ti-file-invoice',
      badge:
        quoteCount > 0 ? (
          <span className="cnt" aria-label={`${quoteCount} quotes`}>
            {quoteCount}
          </span>
        ) : null,
    },
    {
      to: '/portal/orders',
      label: 'Orders',
      icon: 'ti-package',
    },
    {
      to: '/portal/files',
      label: 'My Files',
      icon: 'ti-folder',
    },
    {
      to: '/portal/invoices',
      label: 'Invoices',
      icon: 'ti-receipt',
      badge:
        invoiceCount > 0 ? (
          <span className="cnt" aria-label={`${invoiceCount} pending invoices`}>
            {invoiceCount}
          </span>
        ) : null,
    },
    {
      to: '/portal/messages',
      label: 'Messages',
      icon: 'ti-message',
      badge: msgUnread ? <span className="dot" aria-label="Unread messages" /> : null,
    },
    {
      to: '/portal/profile',
      label: 'Profile',
      icon: 'ti-user',
    },
  ];

  const sidebar = (
    <aside className="side">
      <Brand subtitle="Customer portal" />
      <nav className="nav" id="nav">
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
      <div className="foot">
        <LogoutLink onClick={() => void onLogout()} />
      </div>
    </aside>
  );

  return (
    <Shell
      sidebar={sidebar}
      brandLabel="Customer portal"
      contextLabel={badgeLabel}
      mobileItems={[
        { to: '/portal', label: 'Home', icon: 'ti-layout-dashboard', end: true },
        { to: '/portal/quotes', label: 'Quotes', icon: 'ti-file-invoice' },
        { to: '/portal/orders', label: 'Orders', icon: 'ti-package' },
        { to: '/portal/messages', label: 'Chat', icon: 'ti-message' },
      ]}
    />
  );
}
