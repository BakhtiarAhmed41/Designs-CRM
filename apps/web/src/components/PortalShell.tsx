import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, LogoutLink, Shell, useShellUser } from './Shell';
import { listMyOrders } from '@/lib/orders';
import { listMyInvoices } from '@/lib/billing';
import { listMyConversations } from '@/lib/messaging';
import { getMyCustomer } from '@/lib/customers';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

type NavEntry = {
  to: string;
  label: string;
  icon: string;
  tip: string;
  end?: boolean;
  badge?: ReactNode;
};

export function PortalShell() {
  const { user, initials, onLogout } = useShellUser();
  const qc = useQueryClient();
  useMessagingSocket({
    onUnreadChanged: () => {
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    },
    onMessageNew: () => {
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    },
  });

  const { data: ordersData } = useQuery({
    queryKey: ['portal-orders-nav'],
    queryFn: listMyOrders,
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

  const quoteCount = (ordersData?.orders ?? []).filter(
    (o) =>
      o.type === 'QUOTE_REQUEST' ||
      o.status === 'WAITING_FOR_QUOTATION' ||
      o.status === 'QUOTATION_PROVIDED' ||
      o.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL',
  ).length;
  const invoiceCount = (invoicesData?.invoices ?? []).filter(
    (i) => i.status === 'AWAITING',
  ).length;
  const msgUnread = (convos?.conversations ?? []).some((t) => (t.unreadClient ?? 0) > 0);

  const accountName =
    meCustomer?.customer?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email?.split('@')[0] ||
    'Account';

  const accountType = meCustomer?.customer?.accountType ?? 'PAY_PER_ORDER';
  const badgeClass =
    accountType === 'NET_MONTHLY' ? 'badge-acct badge-net' : 'badge-acct badge-pay';
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
      tip: 'Your account at a glance',
      end: true,
    },
    {
      to: '/portal/quotes',
      label: 'Quotes',
      icon: 'ti-file-invoice',
      tip: 'See our price, then approve to start',
      badge:
        quoteCount > 0 ? (
          <span className="cnt" id="cn-quotes">
            {quoteCount}
          </span>
        ) : null,
    },
    {
      to: '/portal/orders',
      label: 'Orders',
      icon: 'ti-package',
      tip: 'Track progress and download files',
    },
    {
      to: '/portal/files',
      label: 'My Files',
      icon: 'ti-folder',
      tip: 'All your designs, download anytime',
    },
    {
      to: '/portal/invoices',
      label: 'Invoices',
      icon: 'ti-receipt',
      tip: 'Paid and pending, with PDF downloads',
      badge:
        invoiceCount > 0 ? (
          <span className="cnt" id="cn-invoices">
            {invoiceCount}
          </span>
        ) : null,
    },
    {
      to: '/portal/messages',
      label: 'Messages',
      icon: 'ti-message',
      tip: 'Chat directly with our team',
      badge: msgUnread ? <span className="dot" /> : null,
    },
    {
      to: '/portal/profile',
      label: 'Profile',
      icon: 'ti-user',
      tip: 'Details and default settings',
    },
  ];

  const sidebar = (
    <aside className="side">
      <Brand subtitle="Customer portal" />
      <nav className="nav" id="nav">
        {items.map((item) => (
          <span key={item.to} style={{ display: 'contents' }}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'on' : undefined)}
            >
              <i className={`ti ${item.icon}`} /> {item.label} {item.badge}
            </NavLink>
            <span className="tip">{item.tip}</span>
          </span>
        ))}
      </nav>
      <div className="foot">
        <div className="acct">
          <div className="av" id="av">
            {initials}
          </div>
          <div style={{ flex: 1 }}>
            <div className="an" id="acct-name">
              {accountName}
            </div>
            <div className="ae">
              <span className={badgeClass} id="acct-badge">
                {badgeLabel}
              </span>
            </div>
          </div>
        </div>
        <LogoutLink onClick={() => void onLogout()} />
      </div>
    </aside>
  );

  return <Shell sidebar={sidebar} />;
}
