import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { QuoteBuilderModal } from '@/components/QuoteBuilderModal';
import { listMyOrders } from '@/lib/orders';
import { listMyInvoices } from '@/lib/billing';
import { listMyConversations } from '@/lib/messaging';
import { getMyCustomer } from '@/lib/customers';
import { useAuth } from '@/context/AuthContext';
import { money, statusChipClass, statusLabel } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import type { Order } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';

const DONE = ['COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED'];

function isQuote(o: Order) {
  return (
    o.type === 'QUOTE_REQUEST' ||
    ['WAITING_FOR_QUOTATION', 'QUOTATION_PROVIDED', 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL'].includes(
      o.status,
    )
  );
}

export function PortalDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quoteOpen, setQuoteOpen] = useState(false);

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => listMyOrders(),
  });
  const { data: invoicesData } = useQuery({
    queryKey: ['my-invoices'],
    queryFn: listMyInvoices,
  });
  const { data: convosData } = useQuery({
    queryKey: ['my-conversations'],
    queryFn: listMyConversations,
  });
  const { data: meCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });

  const orders = ordersData?.orders ?? [];
  const isNet = meCustomer?.customer?.accountType === 'NET_MONTHLY';
  const activeOrders = orders.filter((o) => o.type === 'ORDER' && !DONE.includes(o.status));
  const quotesReady = orders.filter((o) => o.status === 'QUOTATION_PROVIDED');
  const quotesPending = orders.filter((o) => o.status === 'WAITING_FOR_QUOTATION');
  const unpaidInvoices = (invoicesData?.invoices ?? []).filter((i) => i.status === 'AWAITING');
  const msgUnread = (convosData?.conversations ?? []).reduce(
    (n, c) => n + (c.unreadClient ?? 0),
    0,
  );
  const monthKey = (() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  const monthSpend = (invoicesData?.invoices ?? [])
    .filter((i) => (i.issuedAt ?? '').slice(0, 7) === monthKey)
    .reduce((s, i) => s + (i.amountCents ?? 0), 0);

  const attention = useMemo(() => {
    const rows: Array<{
      key: string;
      thumb: string;
      thumbMar?: boolean;
      title: string;
      meta: string;
      chip: string;
      chipLabel: string;
      action?: { label: string; to: string };
    }> = [];

    for (const o of quotesReady) {
      rows.push({
        key: `q-${o.id}`,
        thumb: serviceTi(o.serviceType),
        thumbMar: true,
        title: o.name ?? 'Quote ready',
        meta: o.humanRef ?? o.id.slice(0, 6),
        chip: 'chip c-quote',
        chipLabel: 'Approve quote',
        action: { label: 'Review', to: `/portal/quotes/${o.id}` },
      });
    }
    for (const o of activeOrders.slice(0, 4)) {
      rows.push({
        key: `o-${o.id}`,
        thumb: serviceTi(o.serviceType),
        title: o.name ?? o.serviceType ?? 'Order',
        meta: o.humanRef ?? o.id.slice(0, 6),
        chip: statusChipClass(o.status),
        chipLabel: statusLabel(o.status),
        action: { label: 'Open', to: `/portal/orders/${o.id}` },
      });
    }
    for (const inv of unpaidInvoices.slice(0, 3)) {
      rows.push({
        key: `i-${inv.id}`,
        thumb: 'ti-receipt',
        thumbMar: true,
        title: inv.coversText ?? 'Invoice due',
        meta: money(inv.amountCents),
        chip: 'chip c-review',
        chipLabel: 'Unpaid',
        action: { label: 'Pay now', to: '/portal/invoices' },
      });
    }

    return rows;
  }, [activeOrders, quotesReady, unpaidInvoices]);

  const recent = orders.filter((o) => !isQuote(o)).slice(0, 6);
  const unpaidTotal = unpaidInvoices.reduce((s, i) => s + i.amountCents, 0);
  const firstName = user?.firstName || 'there';

  return (
    <div>
      <div className="hero">
        <div>
          <h2>Welcome back, {firstName}</h2>
          <p>Quotes, orders, invoices, and messages in one place to keep work moving.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setQuoteOpen(true)}>
          <i className="ti ti-plus" /> Start new quote
        </button>
      </div>

      <div className="metric-row">
        <button type="button" className="metric" onClick={() => navigate('/portal/orders')}>
          <div className="ml">Active orders</div>
          <div className="mv">{activeOrders.length}</div>
          <div className="md">
            {quotesPending.length > 0
              ? `${quotesPending.length} quote${quotesPending.length === 1 ? '' : 's'} being priced`
              : 'In production now'}
          </div>
        </button>
        {isNet ? (
          <button type="button" className="metric" onClick={() => navigate('/portal/invoices')}>
            <div className="ml">This month</div>
            <div className="mv">{money(monthSpend)}</div>
            <div className="md">Statement generates next month</div>
          </button>
        ) : (
          <button type="button" className="metric" onClick={() => navigate('/portal/quotes')}>
            <div className="ml">Quotes to approve</div>
            <div className={`mv${quotesReady.length ? ' alert' : ''}`}>{quotesReady.length}</div>
            <div className="md">{quotesReady.length ? 'Ready for your review' : 'Nothing waiting on you'}</div>
          </button>
        )}
        <button type="button" className="metric" onClick={() => navigate('/portal/invoices')}>
          <div className="ml">{isNet ? 'Statement due' : 'Balance due'}</div>
          <div className={`mv${unpaidTotal ? ' alert' : ''}`}>{money(unpaidTotal)}</div>
          <div className="md">
            {unpaidInvoices.length
              ? `${unpaidInvoices.length} open invoice${unpaidInvoices.length === 1 ? '' : 's'}`
              : 'All paid'}
          </div>
        </button>
        <button type="button" className="metric" onClick={() => navigate('/portal/messages')}>
          <div className="ml">Messages</div>
          <div className={`mv${msgUnread ? ' alert' : ''}`}>{msgUnread}</div>
          <div className="md">{msgUnread ? 'Unread from our team' : 'Inbox is clear'}</div>
        </button>
      </div>

      <div className="board">
        <div className="panel">
          <div className="panel-h">
            <h3>Needs your attention</h3>
          </div>
          {isLoading && <SkeletonRows rows={3} />}
          {!isLoading && attention.length === 0 && (
            <EmptyState
              icon="ti-circle-check"
              title="All caught up"
              description="Nothing needs you right now. Start a new quote when you’re ready."
              action={
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setQuoteOpen(true)}>
                  Start new quote
                </button>
              }
            />
          )}
          {attention.map((row) => (
            <div key={row.key} className="orow">
              <div className={`thumb${row.thumbMar ? ' m' : ''}`}>
                <i className={`ti ${row.thumb}`} />
              </div>
              <div className="oinfo">
                <div className="on">{row.title}</div>
                <div className="om">
                  <span>{row.meta}</span>
                </div>
              </div>
              <span className={row.chip}>{row.chipLabel}</span>
              <div className="oprice">
                {row.action && (
                  <Link to={row.action.to} className="btn btn-primary btn-sm">
                    {row.action.label}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-h">
            <h3>Recent orders</h3>
            <Link to="/portal/orders">View all</Link>
          </div>
          {!isLoading && recent.length === 0 && (
            <EmptyState
              icon="ti-package"
              title="No orders yet"
              description="Approve a quote and it will show up here."
            />
          )}
          {recent.map((o) => (
            <Link
              key={o.id}
              to={`/portal/orders/${o.id}`}
              className="orow"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className={`thumb${serviceThumbClass(o.serviceType) ? ' m' : ''}`}>
                <i className={`ti ${serviceTi(o.serviceType)}`} />
              </div>
              <div className="oinfo">
                <div className="on">{o.name ?? o.serviceType ?? 'Order'}</div>
                <div className="om">
                  <span>{o.humanRef ?? o.id.slice(0, 6)}</span>
                </div>
              </div>
              <span className={statusChipClass(o.status)}>{statusLabel(o.status)}</span>
              <div className="oprice">{money(o.priceCents)}</div>
            </Link>
          ))}
        </div>
      </div>

      <QuoteBuilderModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />
    </div>
  );
}
