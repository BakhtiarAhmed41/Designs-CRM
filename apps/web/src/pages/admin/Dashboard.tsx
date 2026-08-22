import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart } from '@/components/BarChart';
import { GenerateOrderModal } from '@/components/GenerateOrderModal';
import { getDashboardChart, getDashboardStats } from '@/lib/dashboard';
import { listAdminEdits } from '@/lib/edits';
import { listAdminConversations } from '@/lib/messaging';
import { listAdminOrders } from '@/lib/orders';
import { money, dateShort, statusChipClass, statusLabel } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import { canFeature } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import type { FeatureKey, Order, OrderStatus } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

type RangeKey = 'today' | 'week' | 'month' | 'custom';

function customerLabel(o: Order) {
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function relativeTime(iso: string | null | undefined) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return dateShort(iso);
}

export function AdminDashboard() {
  const { user } = useAuth();
  const can = (key: FeatureKey) => canFeature(user?.permissions, key, user?.role);
  const [range, setRange] = useState<RangeKey>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [chartOpen, setChartOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genMode, setGenMode] = useState<'ORDER' | 'QUOTE_REQUEST'>('ORDER');

  const { data: statsData } = useQuery({
    queryKey: ['admin-dashboard-stats'],
    queryFn: getDashboardStats,
    refetchInterval: 30_000,
  });
  const chartDays = range === 'today' ? 1 : range === 'week' ? 7 : range === 'month' ? 30 : 14;
  const { data: chartData } = useQuery({
    queryKey: ['admin-dashboard-chart', chartDays, range, customFrom, customTo],
    queryFn: () =>
      getDashboardChart(
        chartDays,
        range === 'custom' && customFrom && customTo
          ? { from: customFrom, to: customTo }
          : undefined,
      ),
    enabled: range !== 'custom' || Boolean(customFrom && customTo),
    refetchInterval: 60_000,
  });
  const { data: ordersData } = useQuery({
    queryKey: ['admin-orders-latest'],
    queryFn: () => listAdminOrders({ type: 'ORDER', page: 1, pageSize: 6 }),
    enabled: can('orders'),
    refetchInterval: 30_000,
  });
  const { data: quotesData } = useQuery({
    queryKey: ['admin-quotes-to-price'],
    queryFn: () =>
      listAdminOrders({
        type: 'QUOTE_REQUEST',
        statuses: ['WAITING_FOR_QUOTATION', 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL'],
        page: 1,
        pageSize: 6,
      }),
    enabled: can('quotes'),
    refetchInterval: 30_000,
  });
  const { data: convosData } = useQuery({
    queryKey: ['admin-conversations'],
    queryFn: () => listAdminConversations(),
    enabled: can('messages') || can('messages_customer_view'),
    refetchInterval: 30_000,
  });
  const { data: editsData } = useQuery({
    queryKey: ['admin-edits-pending'],
    queryFn: () => listAdminEdits({ status: 'PENDING', pageSize: 6 }),
    enabled: can('edits'),
    refetchInterval: 30_000,
  });

  const stats = statsData?.stats;
  const series = chartData?.series ?? [];
  const orders = ordersData?.orders ?? [];
  const conversations = convosData?.conversations ?? [];
  const edits = editsData?.edits ?? [];

  const unreadMsgs = stats?.unreadMessages ?? 0;
  const quoteOrders = quotesData?.orders ?? [];
  const inProgress = stats?.inProgress ?? 0;
  const newOrders = stats?.newOrders ?? 0;

  const statTiles = useMemo(() => {
    const tiles = [
      { label: 'Delivered this month', value: String(stats?.deliveredThisMonth ?? 0), sub: 'completed jobs', show: can('orders') },
      { label: 'Revenue this month', value: money(stats?.revenueThisMonthCents ?? 0), sub: 'delivered value', alert: true, show: can('billing') },
      { label: 'Open edits', value: String(stats?.revisionsOpen ?? 0), sub: 'pending action', show: can('edits') },
      { label: 'Outstanding', value: money(stats?.outstandingCents ?? 0), sub: 'unpaid work', alert: true, show: can('billing') },
    ];
    return tiles.filter((t) => t.show);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- can() reads current user
  }, [stats, user?.role, user?.permissions]);

  const showInbox = can('messages') || can('messages_customer_view');
  const showOrders = can('orders');
  const showQuotes = can('quotes');
  const showEdits = can('edits');
  const showPulse = can('orders') || can('billing');
  const showWork = showInbox || showOrders || showQuotes || showEdits;
  const showLeft = showInbox || showOrders;
  const showRight = showQuotes || showEdits;

  return (
    <div className="dash">
      <PageHeader
        title="What's happening today"
        subtitle="Everything across Las Vegas Designs USA in one glance so nothing slips."
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

      <div className="tasks">
        {can('orders') && (
          <Link to="/admin/orders" className="task">
            <div className="tt">
              <span className="task-ic m"><i className="ti ti-package" /></span>
              Orders to work
              <span className="badge">{stats?.ordersActive ?? 0}</span>
            </div>
            <div className="tb">
              <b>{newOrders} new</b> unassigned · <b>{inProgress} in progress</b>
            </div>
          </Link>
        )}
        {showInbox && (
          <Link to="/admin/messages/customers" className="task">
            <div className="tt">
              <span className="task-ic m"><i className="ti ti-message" /></span>
              Messages
              <span className="badge">{unreadMsgs}</span>
            </div>
            <div className="tb">
              <b>{unreadMsgs} unread</b> · portal + site chat
            </div>
          </Link>
        )}
        {showQuotes && (
          <Link to="/admin/quotes" className="task">
            <div className="tt">
              <span className="task-ic n"><i className="ti ti-file-invoice" /></span>
              Quotes to price
              <span className="badge">{stats?.quotesToPrice ?? 0}</span>
            </div>
            <div className="tb">
              <b>{stats?.quotesToPrice ?? 0} waiting</b> for your price
            </div>
          </Link>
        )}
        {can('billing') && (
          <Link to="/admin/billing" className="task">
            <div className="tt">
              <span className="task-ic n"><i className="ti ti-cash" /></span>
              Money to collect
            </div>
            <div className="tb">
              <b>{money(stats?.outstandingCents ?? 0)}</b> outstanding
            </div>
          </Link>
        )}
      </div>

      {showPulse && (
        <section className="pulse">
          <div className="pulse-h">
            <h3>Store pulse</h3>
            <div className="pulse-tools">
              <div className="range">
                {(['today', 'week', 'month', 'custom'] as RangeKey[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={range === r ? 'on' : ''}
                    onClick={() => setRange(r)}
                  >
                    {r === 'today' ? 'Today' : r === 'week' ? 'This week' : r === 'month' ? 'This month' : 'Custom'}
                  </button>
                ))}
              </div>
              {range === 'custom' && (
                <div className="pulse-dates">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  <span>to</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              )}
            </div>
          </div>
          <div className="pulse-grid">
            {statTiles.map((t) => (
              <div key={t.label} className="pulse-stat">
                <div className="ps-l">{t.label}</div>
                <div className={`ps-v${t.alert ? ' alert' : ''}`}>{t.value}</div>
                <div className="ps-s">{t.sub}</div>
              </div>
            ))}
          </div>
          <div className="chart-toggle-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChartOpen((v) => !v)}>
              <i className={`ti ${chartOpen ? 'ti-chevron-up' : 'ti-chart-bar'}`} />
              {chartOpen ? 'Hide chart' : 'Show chart'}
            </button>
          </div>
          {chartOpen && (
            <div className="chart-wrap">
              <div className="chart-legend">
                <span className="lg">
                  <span className="lg-dot" style={{ background: 'var(--navy)' }} /> Orders
                </span>
                {can('billing') && (
                  <span className="lg">
                    <span className="lg-dot" style={{ background: 'var(--maroon)' }} /> Revenue
                  </span>
                )}
              </div>
              <div>
                {series.length === 0 ? (
                  <div className="pulse-empty">No chart data yet.</div>
                ) : (
                  <BarChart
                    data={series}
                    valueKey="orders"
                    valueKey2={can('billing') ? 'deliveredValueCents' : undefined}
                    labelKey="date"
                    height={120}
                    formatValue2={(n) => `$${(n / 100).toFixed(0)}`}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {showWork && (
        <div className={`dash-work${!showLeft || !showRight ? ' one' : ''}`}>
          {showLeft && (
            <div className="dash-col">
              {showInbox && (
                <div className="panel">
                  <div className="panel-h">
                    <h3>Inbox</h3>
                    <Link to="/admin/messages/customers" className="btn btn-ghost btn-sm">
                      Open inbox
                    </Link>
                  </div>
                  {conversations.length === 0 && (
                    <EmptyState icon="ti-message" title="No messages yet" description="Customer conversations will appear here." />
                  )}
                  {conversations.slice(0, 6).map((c) => {
                    const name = c.customerName || c.subject || 'Conversation';
                    return (
                      <Link
                        key={c.id}
                        to={`/admin/messages/customers/${c.id}`}
                        className={`mrow${c.unreadAdmin > 0 ? ' unread' : ''}`}
                      >
                        <div className={`mav${c.unreadAdmin > 0 ? ' m' : ''}`}>{initials(name)}</div>
                        <div className="mbody">
                          <div className="mtop">
                            <span className="mname">{name}</span>
                            {c.chatType && <span className="msg-type">{c.chatType}</span>}
                            {c.unreadAdmin > 0 && <span className="dot-unread" />}
                            <span className="mtime">{relativeTime(c.lastMessageAt)}</span>
                          </div>
                          <div className="mtext">{c.lastMessagePreview || 'No messages yet'}</div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {showOrders && (
                <div className="panel">
                  <div className="panel-h">
                    <h3>Latest orders</h3>
                    <Link to="/admin/orders" className="btn btn-ghost btn-sm">
                      All orders
                    </Link>
                  </div>
                  {orders.length === 0 && (
                    <EmptyState icon="ti-package" title="No orders yet" description="New orders will show up here." />
                  )}
                  {orders.slice(0, 6).map((o) => (
                    <Link key={o.id} to={`/admin/orders/${o.id}`} className="orow">
                      <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
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
                </div>
              )}
            </div>
          )}

          {showRight && (
            <div className="dash-col">
              {showQuotes && (
                <div className="panel">
                  <div className="panel-h">
                    <h3>Quotes to price</h3>
                    <Link to="/admin/quotes" className="btn btn-ghost btn-sm">
                      All quotes
                    </Link>
                  </div>
                  {quoteOrders.length === 0 && (
                    <EmptyState icon="ti-file-invoice" title="Inbox clear" description="No quotes waiting for a price." />
                  )}
                  {quoteOrders.slice(0, 6).map((o) => (
                    <Link key={o.id} to={`/admin/quotes/${o.id}`} className="orow">
                      <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
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
                </div>
              )}

              {showEdits && (
                <div className="panel">
                  <div className="panel-h">
                    <h3>Edits & revisions</h3>
                    <Link to="/admin/edits" className="btn btn-ghost btn-sm">
                      View all
                    </Link>
                  </div>
                  {edits.length === 0 && (
                    <EmptyState icon="ti-refresh" title="No open edits" description="Revision requests will land here." />
                  )}
                  {edits.slice(0, 6).map((e) => (
                    <Link key={e.id} to={`/admin/orders/${e.orderId}`} className="orow">
                      <div className={`othumb ${e.kind === 'PAID' ? 'm' : ''}`}>
                        <i className="ti ti-refresh" />
                      </div>
                      <div className="oinfo">
                        <div className="on">{e.orderName ?? 'Edit request'}</div>
                        <div className="om">
                          <span>#{e.orderRef ?? e.orderId.slice(0, 6)} · {e.note}</span>
                          <span className="item-date">{dateShort(e.createdAt)}</span>
                        </div>
                      </div>
                      <span className="chip c-review">Edit pending</span>
                      <div className="oprice edit-price">
                        {e.kind === 'PAID' ? money(e.priceCents) : 'Free'}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
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
