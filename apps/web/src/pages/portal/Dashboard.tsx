import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DateRangeBar } from '@/components/ui/DateRangeBar';
import { QuoteBuilderModal } from '@/components/QuoteBuilderModal';
import { listMyOrders } from '@/lib/orders';
import { listMyInvoices } from '@/lib/billing';
import { datesForPreset, inDateRange, type RangePreset } from '@/lib/dateRange';
import { useAuth } from '@/context/AuthContext';
import { freshOnOpen } from '@/lib/queryRefresh';
import { money, statusChipClass, statusLabel } from '@/lib/format';
import { serviceTi } from '@/lib/serviceIcon';
import type { Order } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';

type WorkTab = 'orders' | 'quotes' | 'invoices';

function isQuote(o: Order) {
  return (
    o.type === 'QUOTE_REQUEST' ||
    ['WAITING_FOR_QUOTATION', 'QUOTATION_PROVIDED', 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL'].includes(
      o.status,
    )
  );
}

export function PortalDashboard() {
  const { user } = useAuth();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [preset, setPreset] = useState<RangePreset>('thisMonth');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [tab, setTab] = useState<WorkTab>('orders');

  const dates = datesForPreset(preset, customFrom, customTo);
  const rangeReady = Boolean(dates.from && dates.to);

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['my-orders', 'dash', dates.from, dates.to],
    queryFn: () =>
      listMyOrders({ type: 'ORDER', page: 1, pageSize: 8, dateFrom: dates.from, dateTo: dates.to }),
    enabled: rangeReady,
    ...freshOnOpen,
  });
  const { data: quotesData, isLoading: quotesLoading } = useQuery({
    queryKey: ['my-quotes', 'dash', dates.from, dates.to],
    queryFn: () =>
      listMyOrders({
        type: 'QUOTE_REQUEST',
        page: 1,
        pageSize: 8,
        dateFrom: dates.from,
        dateTo: dates.to,
      }),
    enabled: rangeReady,
    ...freshOnOpen,
  });
  const { data: invoicesData } = useQuery({
    queryKey: ['my-invoices'],
    queryFn: listMyInvoices,
  });

  const orders = (ordersData?.orders ?? []).filter((o) => !isQuote(o));
  const quotes = quotesData?.orders ?? [];
  const invoices = (invoicesData?.invoices ?? []).filter((i) =>
    rangeReady ? inDateRange(i.issuedAt, dates.from, dates.to) : true,
  );
  const unpaidInvoices = (invoicesData?.invoices ?? []).filter(
    (i) => i.status === 'AWAITING' || i.status === 'PARTIAL',
  );
  const unpaidTotal = unpaidInvoices.reduce((s, i) => s + (i.remainingCents ?? i.amountCents), 0);
  const spentCents = invoices.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const isLoading = ordersLoading || quotesLoading;
  const firstName = user?.firstName || 'there';

  const statTiles = useMemo(
    () => [
      { label: 'Orders', value: String(ordersData?.total ?? orders.length), sub: 'placed in this range' },
      { label: 'Quotes', value: String(quotesData?.total ?? quotes.length), sub: 'requests in this range' },
      { label: 'Spent', value: money(spentCents), sub: 'invoices in this range' },
      { label: 'Balance due', value: money(unpaidTotal), sub: unpaidInvoices.length ? `${unpaidInvoices.length} open` : 'all paid', alert: unpaidTotal > 0 },
    ],
    [orders.length, ordersData?.total, quotes.length, quotesData?.total, spentCents, unpaidInvoices.length, unpaidTotal],
  );

  const tabs: Array<{ id: WorkTab; label: string; count: number; to: string }> = [
    { id: 'orders', label: 'Orders', count: orders.length, to: '/portal/orders' },
    { id: 'quotes', label: 'Quotes', count: quotes.length, to: '/portal/quotes' },
    { id: 'invoices', label: 'Invoices', count: invoices.length, to: '/portal/invoices' },
  ];
  const activeMeta = tabs.find((t) => t.id === tab);

  return (
    <div className="dash">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setQuoteOpen(true)}>
            <i className="ti ti-plus" /> Start new quote
          </button>
        }
      />

      <section className="pulse">
        <div className="pulse-h">
          <h3>Statistics</h3>
          <div className="pulse-tools">
            <DateRangeBar
              preset={preset}
              onPreset={setPreset}
              customFrom={customFrom}
              customTo={customTo}
              onCustomFrom={setCustomFrom}
              onCustomTo={setCustomTo}
            />
          </div>
        </div>
        {rangeReady ? (
          <div
            className="pulse-grid"
            style={{ gridTemplateColumns: `repeat(${statTiles.length}, minmax(0, 1fr))` }}
          >
            {statTiles.map((t) => (
              <div key={t.label} className="pulse-stat">
                <div className="ps-l">{t.label}</div>
                <div className={`ps-v${t.alert ? ' alert' : ''}`}>{t.value}</div>
                <div className="ps-s">{t.sub}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="pulse-empty">Pick a start and end date.</div>
        )}
      </section>

      <div className="panel">
        <div className="dash-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'on' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="dash-tab-count">{t.count}</span>
            </button>
          ))}
          {activeMeta && (
            <Link to={activeMeta.to} className="btn btn-ghost btn-sm dash-tab-link">
              View all
            </Link>
          )}
        </div>

        {isLoading && <SkeletonRows rows={4} />}

        {!isLoading && tab === 'orders' && (
          <>
            {orders.length === 0 && (
              <EmptyState
                icon="ti-package"
                title="No orders yet"
                description="Approve a quote and it will show up here."
              />
            )}
            {orders.map((o) => (
              <Link key={o.id} to={`/portal/orders/${o.id}`} className="orow">
                <div className="othumb">
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
          </>
        )}

        {!isLoading && tab === 'quotes' && (
          <>
            {quotes.length === 0 && (
              <EmptyState
                icon="ti-file-invoice"
                title="No quotes in this range"
                description="Start a new quote when you are ready."
                action={
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setQuoteOpen(true)}>
                    Start new quote
                  </button>
                }
              />
            )}
            {quotes.map((o) => (
              <Link key={o.id} to={`/portal/quotes/${o.id}`} className="orow">
                <div className="othumb">
                  <i className={`ti ${serviceTi(o.serviceType)}`} />
                </div>
                <div className="oinfo">
                  <div className="on">{o.name ?? 'Quote request'}</div>
                  <div className="om">
                    <span>Q-{o.humanRef ?? o.id.slice(0, 6)}</span>
                  </div>
                </div>
                <span className={statusChipClass(o.status)}>{statusLabel(o.status)}</span>
                <div className="oprice">{money(o.priceCents)}</div>
              </Link>
            ))}
          </>
        )}

        {!isLoading && tab === 'invoices' && (
          <>
            {invoices.length === 0 && (
              <EmptyState icon="ti-receipt" title="No invoices in this range" description="New invoices will show up here." />
            )}
            {invoices.map((inv) => (
              <Link key={inv.id} to="/portal/invoices" className="orow">
                <div className="othumb">
                  <i className="ti ti-receipt" />
                </div>
                <div className="oinfo">
                  <div className="on">{inv.coversText ?? 'Invoice'}</div>
                  <div className="om">
                    <span>{inv.status === 'PARTIAL' ? 'Partial' : inv.status === 'PAID' ? 'Paid' : 'Unpaid'}</span>
                  </div>
                </div>
                <span className={`chip ${inv.status === 'PAID' ? 'c-paid' : 'c-review'}`}>
                  {inv.status === 'PAID' ? 'Paid' : inv.status === 'PARTIAL' ? 'Partial' : 'Unpaid'}
                </span>
                <div className="oprice">{money(inv.remainingCents ?? inv.amountCents)}</div>
              </Link>
            ))}
          </>
        )}
      </div>

      <QuoteBuilderModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />
    </div>
  );
}
