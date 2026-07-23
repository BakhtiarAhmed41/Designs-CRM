import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { NotificationBell } from '@/components/NotificationBell';
import { QuoteBuilderModal } from '@/components/QuoteBuilderModal';
import { listMyOrders } from '@/lib/orders';
import { listMyInvoices } from '@/lib/billing';
import { listMyConversations } from '@/lib/messaging';
import { getMyCustomer } from '@/lib/customers';
import { useAuth } from '@/context/AuthContext';
import { money, statusChipClass, statusLabel } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import type { Order } from '@/lib/types';

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
    queryFn: listMyOrders,
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
  const monthSpend = orders
    .filter((o) => {
      const d = new Date(o.createdAt);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, o) => s + (o.priceCents ?? 0), 0);

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

    const waiting = activeOrders.find((o) =>
      ['REVISION_REQUESTED', 'PENDING_PAYMENT'].includes(o.status),
    );
    if (waiting) {
      rows.push({
        key: waiting.id,
        thumb: 'ti-alert-circle',
        thumbMar: true,
        title: waiting.name ?? 'Order needs your input',
        meta: `Order #${waiting.humanRef ?? waiting.id.slice(0, 6)}`,
        chip: 'chip c-wait',
        chipLabel: 'Action needed',
        action: { label: 'Reply', to: '/portal/messages' },
      });
    }

    if (quotesReady[0]) {
      const q = quotesReady[0];
      rows.push({
        key: q.id,
        thumb: 'ti-file-invoice',
        thumbMar: true,
        title: `Quote ready — ${q.name ?? 'your request'}`,
        meta: `#${q.humanRef ?? q.id.slice(0, 6)} · ${money(q.quotations?.[0]?.amountCents ?? null)}`,
        chip: 'chip c-quote',
        chipLabel: 'Approve to start',
        action: { label: 'Review', to: '/portal/quotes' },
      });
    }

    if (unpaidInvoices[0]) {
      const inv = unpaidInvoices[0];
      rows.push({
        key: inv.id,
        thumb: 'ti-receipt',
        title: inv.coversText ?? 'Invoice pending payment',
        meta: `${money(inv.amountCents, inv.currency)} · ${inv.periodMonth ?? 'Due soon'}`,
        chip: 'chip c-unpaid',
        chipLabel: 'Pending',
        action: { label: 'Pay now', to: '/portal/invoices' },
      });
    }

    return rows;
  }, [activeOrders, quotesReady, unpaidInvoices]);

  const recent = orders.filter((o) => !isQuote(o)).slice(0, 4);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Welcome back, {user?.firstName || 'there'}</h1>
          <div className="sub">Here&apos;s where everything stands right now.</div>
        </div>
        <div className="topbar">
          <NotificationBell />
          <button type="button" className="btn btn-primary" onClick={() => setQuoteOpen(true)}>
            <i className="ti ti-plus" /> New order
          </button>
        </div>
      </div>

      <div className="tasks">
        <div className="task" onClick={() => navigate('/portal/orders')} role="button" tabIndex={0}>
          <div className="tt">
            <i className="ti ti-package" style={{ color: 'var(--navy)' }} /> Active orders
            {activeOrders.length > 0 && <span className="badge">{activeOrders.length}</span>}
          </div>
          <div className="tb">
            <b>{activeOrders.length} in progress</b>
            {quotesPending.length > 0 && ` · ${quotesPending.length} awaiting quote`}
          </div>
        </div>

        {isNet ? (
          <>
            <div className="task" onClick={() => navigate('/portal/invoices')} role="button" tabIndex={0}>
              <div className="tt">
                <i className="ti ti-cash" style={{ color: 'var(--maroon)' }} /> This month
              </div>
              <div className="tb">
                <b>{money(monthSpend)}</b> so far · statement generates next month
              </div>
            </div>
            <div className="task" onClick={() => navigate('/portal/invoices')} role="button" tabIndex={0}>
              <div className="tt">
                <i className="ti ti-file-invoice" style={{ color: 'var(--maroon)' }} /> Statement due
              </div>
              <div className="tb">
                {unpaidInvoices[0] ? (
                  <>
                    <b>{money(unpaidInvoices[0].amountCents)}</b> pending
                  </>
                ) : (
                  <b>Nothing due</b>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="task" onClick={() => navigate('/portal/quotes')} role="button" tabIndex={0}>
              <div className="tt">
                <i className="ti ti-file-invoice" style={{ color: 'var(--maroon)' }} /> Quote to approve
                {quotesReady.length > 0 && <span className="badge">{quotesReady.length}</span>}
              </div>
              <div className="tb">
                {quotesReady.length > 0 ? (
                  <b>Ready to review</b>
                ) : (
                  <b>Nothing waiting on you</b>
                )}
              </div>
            </div>
            <div className="task" onClick={() => navigate('/portal/invoices')} role="button" tabIndex={0}>
              <div className="tt">
                <i className="ti ti-credit-card" style={{ color: 'var(--maroon)' }} /> Balance due
              </div>
              <div className="tb">
                {unpaidInvoices.length > 0 ? (
                  <b>{money(unpaidInvoices.reduce((s, i) => s + i.amountCents, 0))}</b>
                ) : (
                  <b>All paid</b>
                )}
              </div>
            </div>
          </>
        )}

        <div className="task" onClick={() => navigate('/portal/messages')} role="button" tabIndex={0}>
          <div className="tt">
            <i className="ti ti-message" style={{ color: 'var(--navy)' }} /> Messages
            {msgUnread > 0 && <span className="badge">{msgUnread}</span>}
          </div>
          <div className="tb">
            {msgUnread > 0 ? (
              <b>{msgUnread} unread</b>
            ) : (
              <b>No unread messages</b>
            )}{' '}
            from our team
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">Needs your attention</span>
        </div>
        {isLoading && <div className="empty">Loading…</div>}
        {!isLoading && attention.length === 0 && (
          <div className="empty">
            <i className="ti ti-circle-check" />
            <p>All caught up — nothing needs your attention.</p>
          </div>
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

      <div className="card">
        <div className="card-h">
          <span className="ct">Recent activity</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/portal/orders')}>
            View all orders
          </button>
        </div>
        {!isLoading && recent.length === 0 && (
          <div className="empty">
            <p>No orders yet. Start with a new quote.</p>
          </div>
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
                <span>
                  <i className="ti ti-hash" style={{ fontSize: 12 }} />
                  {o.humanRef ?? o.id.slice(0, 6)}
                </span>
                <span>{o.serviceType}</span>
              </div>
            </div>
            <span className={statusChipClass(o.status)}>{statusLabel(o.status)}</span>
            <div className="oprice">{money(o.priceCents)}</div>
          </Link>
        ))}
      </div>

      <QuoteBuilderModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />
    </div>
  );
}
