import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NotificationBell } from '@/components/NotificationBell';
import { GlobalSearch } from '@/components/GlobalSearch';
import { BarChart } from '@/components/BarChart';
import { GenerateOrderModal } from '@/components/GenerateOrderModal';
import { getDashboardChart, getDashboardStats } from '@/lib/dashboard';
import { listAdminEdits } from '@/lib/edits';
import { listAdminConversations } from '@/lib/messaging';
import { listAdminOrders } from '@/lib/orders';
import { money, dateShort, statusChipClass, statusLabel } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { Order, OrderStatus } from '@/lib/types';

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

function labelClass(label: string | null | undefined) {
  switch (label) {
    case 'EDIT':
      return 'mlabel lbl-edit';
    case 'PAYMENT':
      return 'mlabel lbl-pay';
    case 'IMPORTANT':
      return 'mlabel lbl-imp';
    case 'CUSTOM':
      return 'mlabel lbl-custom';
    default:
      return '';
  }
}

export function AdminDashboard() {
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
    queryKey: ['admin-dashboard-chart', chartDays],
    queryFn: () => getDashboardChart(chartDays),
    refetchInterval: 60_000,
  });
  const { data: ordersData } = useQuery({
    queryKey: ['admin-orders'],
    queryFn: () => listAdminOrders(),
    refetchInterval: 30_000,
  });
  const { data: convosData } = useQuery({
    queryKey: ['admin-conversations'],
    queryFn: () => listAdminConversations(),
    refetchInterval: 30_000,
  });
  const { data: editsData } = useQuery({
    queryKey: ['admin-edits-pending'],
    queryFn: () => listAdminEdits('PENDING'),
    refetchInterval: 30_000,
  });

  const stats = statsData?.stats;
  const series = chartData?.series ?? [];
  const orders = ordersData?.orders ?? [];
  const conversations = convosData?.conversations ?? [];
  const edits = editsData?.edits ?? [];

  const unreadMsgs = conversations.reduce((n, c) => n + (c.unreadAdmin ?? 0), 0);
  const quoteOrders = orders.filter(
    (o) =>
      o.status === 'WAITING_FOR_QUOTATION' ||
      o.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL',
  );

  const inProgress = orders.filter((o) => o.status === 'IN_PROGRESS').length;
  const newOrders = orders.filter((o) => o.status === 'CREATED' || o.status === 'PENDING_PAYMENT').length;

  const statTiles = useMemo(
    () => [
      { label: 'Active orders', value: String(stats?.ordersActive ?? 0), sub: `${inProgress} in progress` },
      { label: 'Quotes to price', value: String(stats?.quotesToPrice ?? 0), sub: 'waiting on you', maroon: true },
      { label: 'Delivered this month', value: String(stats?.deliveredThisMonth ?? 0), sub: 'completed' },
      { label: 'Revenue this month', value: money(stats?.revenueThisMonthCents ?? 0), sub: 'delivered value', maroon: true },
      { label: 'Open edits', value: String(stats?.revisionsOpen ?? 0), sub: 'pending action' },
      { label: 'Outstanding', value: money(stats?.outstandingCents ?? 0), sub: 'unpaid work' },
    ],
    [stats, inProgress],
  );

  return (
    <div>
      <div className="ph">
        <div>
          <h1>What&apos;s happening today</h1>
          <div className="sub">
            Everything across Las Vegas Designs USA in one glance — so nothing slips.
          </div>
        </div>
        <div className="topwrap">
          <NotificationBell />
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
        </div>
      </div>

      <div style={{ margin: '14px 0 4px' }}>
        <GlobalSearch />
      </div>

      <div className="tasks">
        <Link to="/admin/orders" className="task" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="tt">
            <i className="ti ti-package" style={{ color: 'var(--maroon)' }} /> Orders to work{' '}
            <span className="badge">{stats?.ordersActive ?? 0}</span>
          </div>
          <div className="tb">
            <b>{newOrders} new</b> unassigned · <b>{inProgress} in progress</b>
          </div>
        </Link>
        <Link to="/admin/messages" className="task" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="tt">
            <i className="ti ti-message" style={{ color: 'var(--maroon)' }} /> Messages{' '}
            <span className="badge">{unreadMsgs}</span>
          </div>
          <div className="tb">
            <b>{unreadMsgs} unread</b> · portal + site chat
          </div>
        </Link>
        <Link to="/admin/quotes" className="task" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="tt">
            <i className="ti ti-file-invoice" style={{ color: 'var(--navy)' }} /> Quotes to price{' '}
            <span className="badge">{stats?.quotesToPrice ?? 0}</span>
          </div>
          <div className="tb">
            <b>{stats?.quotesToPrice ?? 0} waiting</b> for your price
          </div>
        </Link>
        <Link to="/admin/billing" className="task" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="tt">
            <i className="ti ti-cash" style={{ color: 'var(--navy)' }} /> Money to collect
          </div>
          <div className="tb">
            <b>{money(stats?.outstandingCents ?? 0)}</b> outstanding
          </div>
        </Link>
      </div>

      <div className="stats">
        <div className="stats-h">
          <span className="st">Store stats</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={{
                    border: '0.5px solid var(--line)',
                    borderRadius: 7,
                    padding: '5px 9px',
                    fontSize: 12,
                    fontFamily: 'inherit',
                  }}
                />
                <span style={{ color: 'var(--faint)', fontSize: 12 }}>to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={{
                    border: '0.5px solid var(--line)',
                    borderRadius: 7,
                    padding: '5px 9px',
                    fontSize: 12,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div className="stats-grid">
          {statTiles.map((t) => (
            <div key={t.label} className="sc">
              <div className="scl">{t.label}</div>
              <div className={`scv${t.maroon ? ' m' : ''}`}>{t.value}</div>
              <div className="scd">{t.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '0.5px solid var(--line)', padding: '8px 16px', textAlign: 'center' }}>
          <a
            onClick={() => setChartOpen((v) => !v)}
            style={{ fontSize: 12, color: 'var(--navy)', cursor: 'pointer', fontWeight: 500 }}
          >
            <i className="ti ti-chart-bar" /> {chartOpen ? 'Hide chart' : 'Show chart'}
          </a>
        </div>
        {chartOpen && (
          <div className="chart-wrap">
            <div className="chart-legend">
              <span className="lg">
                <span className="lg-dot" style={{ background: 'var(--navy)' }} /> Orders
              </span>
              <span className="lg">
                <span className="lg-dot" style={{ background: 'var(--maroon)' }} /> Revenue
              </span>
            </div>
            <div id="stats-chart">
              {series.length === 0 ? (
                <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>No chart data yet.</div>
              ) : (
                <BarChart data={series} valueKey="orders" labelKey="date" height={120} />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-message" /> Recent messages
            </span>
            <Link to="/admin/messages">Open inbox</Link>
          </div>
          <div className="scroll-body">
            {conversations.length === 0 && (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>No messages yet.</div>
            )}
            {conversations.slice(0, 6).map((c) => {
              const name = c.customerName || c.subject || 'Conversation';
              return (
                <Link
                  key={c.id}
                  to={`/admin/messages?c=${c.id}`}
                  className={`mrow${c.unreadAdmin > 0 ? ' unread' : ''}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className={`mav${c.unreadAdmin > 0 ? ' m' : ''}`}>{initials(name)}</div>
                  <div className="mbody">
                    <div className="mtop">
                      <span className="mname">{name}</span>
                      {c.label && <span className={labelClass(c.label)}>{c.label}</span>}
                      {c.unreadAdmin > 0 && <span className="dot-unread" />}
                      <span className="mtime">{relativeTime(c.lastMessageAt)}</span>
                    </div>
                    <div className="mtext">{c.lastMessagePreview || 'No messages yet'}</div>
                  </div>
                </Link>
              );
            })}
          </div>
          <Link to="/admin/messages" className="scroll-foot" style={{ display: 'block', textDecoration: 'none' }}>
            <i className="ti ti-chevron-down" style={{ fontSize: 12 }} /> Show older
          </Link>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-package" /> Latest orders
            </span>
            <Link to="/admin/orders">All orders</Link>
          </div>
          <div className="scroll-body">
            {orders.slice(0, 6).map((o) => (
              <Link
                key={o.id}
                to={`/admin/orders/${o.id}`}
                className="orow"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
                  <i className={`ti ${serviceTi(o.serviceType)}`} />
                </div>
                <div className="oinfo">
                  <div className="on">{o.name ?? o.serviceType ?? 'Order'}</div>
                  <div className="om">
                    <span>
                      <i className="ti ti-hash" style={{ fontSize: 11 }} />
                      {o.humanRef ?? o.id.slice(0, 6)}
                    </span>
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
          <Link to="/admin/orders" className="scroll-foot" style={{ display: 'block', textDecoration: 'none' }}>
            <i className="ti ti-chevron-down" style={{ fontSize: 12 }} /> Show older
          </Link>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-file-invoice" /> Quotes to price
            </span>
            <Link to="/admin/quotes">All quotes</Link>
          </div>
          <div className="scroll-body">
            {quoteOrders.length === 0 && (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>Nothing waiting.</div>
            )}
            {quoteOrders.slice(0, 6).map((o) => (
              <Link
                key={o.id}
                to={`/admin/quotes/${o.id}`}
                className="orow"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
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
          <Link to="/admin/quotes" className="scroll-foot" style={{ display: 'block', textDecoration: 'none' }}>
            <i className="ti ti-chevron-down" style={{ fontSize: 12 }} /> Show older
          </Link>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-refresh" /> Edit &amp; revision requests
            </span>
            <Link to="/admin/edits">View all</Link>
          </div>
          <div className="scroll-body">
            {edits.length === 0 && (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>No open edits.</div>
            )}
            {edits.slice(0, 6).map((e) => (
              <Link
                key={e.id}
                to={`/admin/orders/${e.orderId}`}
                className="orow"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
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
                <div className="oprice" style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 500 }}>
                  {e.kind === 'PAID' ? money(e.priceCents) : 'Free'}
                </div>
              </Link>
            ))}
          </div>
          <Link to="/admin/edits" className="scroll-foot" style={{ display: 'block', textDecoration: 'none' }}>
            <i className="ti ti-chevron-down" style={{ fontSize: 12 }} /> Show older
          </Link>
        </div>
      </div>

      <GenerateOrderModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        defaultMode={genMode}
      />
    </div>
  );
}
