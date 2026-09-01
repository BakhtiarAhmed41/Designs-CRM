import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DateRangeBar } from '@/components/ui/DateRangeBar';
import { GenerateOrderModal } from '@/components/GenerateOrderModal';
import { getDashboardStats } from '@/lib/dashboard';
import { datesForPreset, inDateRange, type RangePreset } from '@/lib/dateRange';
import { listAdminEdits } from '@/lib/edits';
import { listAdminOrders } from '@/lib/orders';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { money, dateShort, statusChipClass, statusLabel } from '@/lib/format';
import { serviceTi } from '@/lib/serviceIcon';
import { canFeature } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import type { FeatureKey, Order, OrderStatus } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

type WorkTab = 'orders' | 'quotes' | 'edits';

function customerLabel(o: Order) {
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

export function AdminDashboard() {
  const { user } = useAuth();
  const can = (key: FeatureKey) => canFeature(user?.permissions, key, user?.role);
  const [genOpen, setGenOpen] = useState(false);
  const [genMode, setGenMode] = useState<'ORDER' | 'QUOTE_REQUEST'>('ORDER');
  const [preset, setPreset] = useState<RangePreset>('thisMonth');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [tab, setTab] = useState<WorkTab>('orders');

  const dates = datesForPreset(preset, customFrom, customTo);
  const rangeReady = Boolean(dates.from && dates.to);

  const { data: statsData } = useQuery({
    queryKey: ['admin-dashboard-stats', dates.from, dates.to],
    queryFn: () => getDashboardStats(dates),
    enabled: rangeReady,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });
  const { data: ordersData } = useQuery({
    queryKey: ['admin-orders-latest', dates.from, dates.to],
    queryFn: () =>
      listAdminOrders({
        type: 'ORDER',
        page: 1,
        pageSize: 8,
        dateFrom: dates.from,
        dateTo: dates.to,
      }),
    enabled: can('orders') && rangeReady,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });
  const { data: quotesData } = useQuery({
    queryKey: ['admin-quotes-to-price', dates.from, dates.to],
    queryFn: () =>
      listAdminOrders({
        type: 'QUOTE_REQUEST',
        statuses: ['WAITING_FOR_QUOTATION', 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL'],
        page: 1,
        pageSize: 8,
        dateFrom: dates.from,
        dateTo: dates.to,
      }),
    enabled: can('quotes') && rangeReady,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });
  const { data: editsData } = useQuery({
    queryKey: ['admin-edits-pending'],
    queryFn: () => listAdminEdits({ status: 'PENDING', pageSize: 20 }),
    enabled: can('edits'),
    refetchInterval: whenVisible(30_000),
  });

  const stats = statsData?.stats;
  const orders = ordersData?.orders ?? [];
  const quoteOrders = quotesData?.orders ?? [];
  const edits = (editsData?.edits ?? []).filter((e) =>
    rangeReady ? inDateRange(e.createdAt, dates.from, dates.to) : true,
  );

  const statTiles = useMemo(() => {
    const tiles = [
      { label: 'Delivered', value: String(stats?.deliveredThisMonth ?? 0), sub: 'completed jobs', show: can('orders') },
      { label: 'Revenue', value: money(stats?.revenueThisMonthCents ?? 0), sub: 'delivered value', alert: true, show: can('billing') },
      { label: 'Open revisions', value: String(stats?.revisionsOpen ?? 0), sub: 'pending action', show: can('edits') },
      { label: 'Pending', value: money(stats?.pendingCents ?? 0), sub: 'not yet due', show: can('billing') },
      { label: 'Overdue', value: money(stats?.overdueCents ?? 0), sub: 'past due date', alert: true, show: can('billing') },
    ];
    return tiles.filter((t) => t.show);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- can() reads current user
  }, [stats, user?.role, user?.permissions]);

  const showOrders = can('orders');
  const showQuotes = can('quotes');
  const showEdits = can('edits');
  const showPulse = can('orders') || can('billing');
  const tabs = useMemo(() => {
    const list: Array<{ id: WorkTab; label: string; count: number; to: string; show: boolean }> = [
      { id: 'orders', label: 'Orders', count: orders.length, to: '/admin/orders', show: showOrders },
      { id: 'quotes', label: 'Quotes', count: quoteOrders.length, to: '/admin/quotes', show: showQuotes },
      { id: 'edits', label: 'Revisions', count: edits.length, to: '/admin/edits', show: showEdits },
    ];
    return list.filter((t) => t.show);
  }, [edits.length, orders.length, quoteOrders.length, showEdits, showOrders, showQuotes]);

  const activeTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? 'orders');
  const activeMeta = tabs.find((t) => t.id === activeTab);

  return (
    <div className="dash">
      <PageHeader
        title="What's happening today"
        actions={
          <>
            {can('quotes') && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setGenMode('QUOTE_REQUEST');
                  setGenOpen(true);
                }}
              >
                <i className="ti ti-file-dollar" /> Generate quote
              </button>
            )}
            {can('orders') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setGenMode('ORDER');
                  setGenOpen(true);
                }}
              >
                <i className="ti ti-plus" /> Generate order
              </button>
            )}
          </>
        }
      />

      {showPulse && (
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
              style={{ gridTemplateColumns: `repeat(${Math.max(statTiles.length, 1)}, minmax(0, 1fr))` }}
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
      )}

      {tabs.length > 0 && (
        <div className="panel">
          <div className="dash-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={activeTab === t.id ? 'on' : ''}
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

          {activeTab === 'orders' && (
            <>
              {orders.length === 0 && (
                <EmptyState icon="ti-package" title="No orders yet" description="New orders in this range will show up here." />
              )}
              {orders.slice(0, 8).map((o) => (
                <Link key={o.id} to={`/admin/orders/${o.id}`} className="orow">
                  <div className="othumb">
                    <i className={`ti ${serviceTi(o.serviceType)}`} />
                  </div>
                  <div className="oinfo">
                    <div className="on">{o.name ?? o.serviceType ?? 'Order'}</div>
                    <div className="om">
                      <span>{o.humanRef ?? o.id.slice(0, 6)}</span>
                      <span>{customerLabel(o)}</span>
                    </div>
                  </div>
                  <span className={statusChipClass(o.status as OrderStatus)}>
                    {statusLabel(o.status as OrderStatus)}
                  </span>
                  <div className="oprice">{money(o.priceCents)}</div>
                </Link>
              ))}
            </>
          )}

          {activeTab === 'quotes' && (
            <>
              {quoteOrders.length === 0 && (
                <EmptyState icon="ti-file-invoice" title="No quotes waiting" description="Quotes that need a price will land here." />
              )}
              {quoteOrders.slice(0, 8).map((o) => (
                <Link key={o.id} to={`/admin/quotes/${o.id}`} className="orow">
                  <div className="othumb">
                    <i className={`ti ${serviceTi(o.serviceType)}`} />
                  </div>
                  <div className="oinfo">
                    <div className="on">{o.name ?? 'Quote request'}</div>
                    <div className="om">
                      <span>Q-{o.humanRef ?? o.id.slice(0, 6)}</span>
                      <span>{customerLabel(o)}</span>
                    </div>
                  </div>
                  <span className="chip c-quote">Needs price</span>
                  <div className="oprice">{money(o.priceCents)}</div>
                </Link>
              ))}
            </>
          )}

          {activeTab === 'edits' && (
            <>
              {edits.length === 0 && (
                <EmptyState icon="ti-refresh" title="No open revisions" description="Revisions in this range will land here." />
              )}
              {edits.slice(0, 8).map((e) => (
                <Link key={e.id} to={`/admin/orders/${e.orderId}`} className="orow">
                  <div className="othumb">
                    <i className="ti ti-refresh" />
                  </div>
                  <div className="oinfo">
                    <div className="on">{e.orderName ?? 'Revision'}</div>
                    <div className="om">
                      <span>#{e.orderRef ?? e.orderId.slice(0, 6)}</span>
                      <span className="item-date">{dateShort(e.createdAt)}</span>
                    </div>
                    {e.note ? (
                      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--dash-ink)', whiteSpace: 'pre-wrap' }}>
                        {e.note}
                      </div>
                    ) : null}
                  </div>
                  <span className="chip c-review">Revision requested</span>
                  <div className="oprice edit-price">
                    {e.kind === 'PAID' ? money(e.priceCents) : 'Free'}
                  </div>
                </Link>
              ))}
            </>
          )}
        </div>
      )}

      <GenerateOrderModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        defaultMode={genMode}
      />
    </div>
  );
}
