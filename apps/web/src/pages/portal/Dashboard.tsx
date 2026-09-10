import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { DateRangeSelect } from '@/components/ui/DateRangeSelect';
import { listMyOrders } from '@/lib/orders';
import { listMyInvoices } from '@/lib/billing';
import { listMyAllEdits } from '@/lib/edits';
import { listNotifications, markNotificationRead } from '@/lib/notifications';
import { datesForPortalPreset, inDateRange, type PortalRangePreset } from '@/lib/dateRange';
import { useAuth } from '@/context/AuthContext';
import { freshOnOpen } from '@/lib/queryRefresh';
import { money, quoteLifecycleChip, customerOrderChip } from '@/lib/format';
import { serviceCategoryLabel, serviceTi } from '@/lib/serviceIcon';
import type { Order } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';

type WorkTab = 'orders' | 'quotes' | 'revisions' | 'invoices';

const ACTIVE_ORDER = new Set([
  'CREATED',
  'PENDING_PAYMENT',
  'IN_PROGRESS',
  'READY_TO_SEND',
  'REVISION_REQUESTED',
]);
const ACTIVE_QUOTE = new Set([
  'CREATED',
  'WAITING_FOR_QUOTATION',
  'QUOTATION_PROVIDED',
  'WAITING_FOR_ADMIN_QUOTATION_APPROVAL',
]);

function isQuote(o: Order) {
  return (
    o.type === 'QUOTE_REQUEST' ||
    ['WAITING_FOR_QUOTATION', 'QUOTATION_PROVIDED', 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL'].includes(
      o.status,
    )
  );
}

function activityAction(title: string, link: string | null) {
  const t = title.toLowerCase();
  if (t.includes('quote')) return { label: 'Review quote', to: link || '/portal/quotes' };
  if (t.includes('deliver') || t.includes('file')) return { label: 'Download files', to: link || '/portal/files' };
  if (t.includes('invoice') || t.includes('payment')) return { label: 'View invoice', to: link || '/portal/invoices' };
  if (link) return { label: 'View', to: link };
  return null;
}

function relativeTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PortalDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [preset, setPreset] = useState<PortalRangePreset>('thisMonth');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [tab, setTab] = useState<WorkTab>('orders');
  const [activityPage, setActivityPage] = useState(1);

  const dates = datesForPortalPreset(preset, customFrom, customTo);
  const rangeReady = preset === 'allTime' || Boolean(dates.from && dates.to);
  const dateFrom = dates.from || undefined;
  const dateTo = dates.to || undefined;

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['my-orders', 'dash', dateFrom, dateTo],
    queryFn: () =>
      listMyOrders({ type: 'ORDER', page: 1, pageSize: 8, dateFrom, dateTo }),
    enabled: rangeReady,
    ...freshOnOpen,
  });
  const { data: quotesData, isLoading: quotesLoading } = useQuery({
    queryKey: ['my-quotes', 'dash', dateFrom, dateTo],
    queryFn: () =>
      listMyOrders({
        type: 'QUOTE_REQUEST',
        page: 1,
        pageSize: 8,
        dateFrom,
        dateTo,
      }),
    enabled: rangeReady,
    ...freshOnOpen,
  });
  const { data: invoicesData } = useQuery({
    queryKey: ['my-invoices'],
    queryFn: listMyInvoices,
  });
  const { data: editsData } = useQuery({
    queryKey: ['my-edits'],
    queryFn: listMyAllEdits,
    ...freshOnOpen,
  });
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['my-activity', activityPage],
    queryFn: () => listNotifications({ page: activityPage, pageSize: 10 }),
    ...freshOnOpen,
  });

  const orders = (ordersData?.orders ?? []).filter((o) => !isQuote(o) && ACTIVE_ORDER.has(o.status));
  const quotes = (quotesData?.orders ?? []).filter((o) => ACTIVE_QUOTE.has(o.status));
  const revisions = (editsData?.edits ?? []).filter((e) => e.status !== 'DONE');
  const unpaidInvoices = (invoicesData?.invoices ?? []).filter(
    (i) => i.status === 'AWAITING' || i.status === 'PARTIAL',
  );
  const rangeInvoices = (invoicesData?.invoices ?? []).filter((i) =>
    rangeReady && dateFrom && dateTo ? inDateRange(i.issuedAt, dateFrom, dateTo) : true,
  );
  const unpaidTotal = unpaidInvoices.reduce((s, i) => s + (i.remainingCents ?? i.amountCents), 0);
  const paidCents = rangeInvoices
    .filter((i) => i.status === 'PAID' || i.status === 'PARTIAL')
    .reduce((s, i) => s + (i.amountCents - (i.remainingCents ?? (i.status === 'PAID' ? 0 : i.amountCents))), 0);
  const isLoading = ordersLoading || quotesLoading;
  const firstName = user?.firstName || 'there';
  const activities = activityData?.notifications ?? [];
  const activityPages = activityData?.totalPages ?? 1;

  const orderCount = ordersData?.total ?? orders.length;
  const quoteCount = quotesData?.total ?? quotes.length;
  const statTiles = useMemo(
    () => [
      { label: 'Orders', value: String(orderCount), sub: 'Orders placed' },
      {
        label: 'Quotes',
        value: String(quoteCount),
        sub: quoteCount === 0 ? 'No quote requests' : 'Quote requests',
      },
      { label: 'Total paid', value: money(paidCents), sub: 'Payments completed' },
      {
        label: 'Balance due',
        value: money(unpaidTotal),
        sub: unpaidTotal > 0 ? 'Amount pending' : 'All paid',
        alert: unpaidTotal > 0,
      },
    ],
    [orderCount, quoteCount, paidCents, unpaidTotal],
  );

  const tabs: Array<{ id: WorkTab; label: string; count: number; to: string; viewAll: string }> = [
    { id: 'orders', label: 'Orders', count: orders.length, to: '/portal/orders', viewAll: 'View All Orders' },
    { id: 'quotes', label: 'Quotes', count: quotes.length, to: '/portal/quotes', viewAll: 'View All Quotes' },
    { id: 'revisions', label: 'Revisions', count: revisions.length, to: '/portal/revisions', viewAll: 'View All Revisions' },
    { id: 'invoices', label: 'Invoices', count: unpaidInvoices.length, to: '/portal/invoices', viewAll: 'View All Invoices' },
  ];
  const activeMeta = tabs.find((t) => t.id === tab);

  return (
    <div className="dash">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        actions={
          <Link to="/portal/quotes/new" className="btn btn-primary">
            <i className="ti ti-plus" /> Request a quote
          </Link>
        }
      />

      <section className="pulse">
        <div className="pulse-h">
          <h3>Statistics</h3>
          <div className="pulse-tools">
            <DateRangeSelect
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
          <div className="pulse-grid">
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
        <div className="panel-head">
          <div>
            <h3>Active Requests</h3>
            <p className="panel-sub">
              Track your active orders, quotes, revisions and invoices here. View your complete history anytime.
            </p>
          </div>
        </div>
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
              {activeMeta.viewAll}
            </Link>
          )}
        </div>

        {isLoading && <SkeletonRows rows={4} />}

        {!isLoading && tab === 'orders' && (
          <>
            {orders.length === 0 && (
              <EmptyState
                icon="ti-package"
                title="No active orders"
                description="Approve a quote and it will show up here."
              />
            )}
            {orders.map((o) => {
              const chip = customerOrderChip(o);
              return (
                <Link key={o.id} to={`/portal/orders/${o.id}`} className="orow">
                  <div className="othumb">
                    <i className={`ti ${serviceTi(o.serviceType)}`} />
                  </div>
                  <div className="oinfo">
                    <div className="on">{o.name ?? o.serviceType ?? 'Order'}</div>
                    <div className="om">
                      <span>{o.humanRef ?? o.id.slice(0, 6)}</span>
                      <span>{serviceCategoryLabel(o.serviceType)}</span>
                    </div>
                  </div>
                  <span className={chip.cls}>{chip.label}</span>
                  <div className="oprice">{money(o.priceCents)}</div>
                </Link>
              );
            })}
          </>
        )}

        {!isLoading && tab === 'quotes' && (
          <>
            {quotes.length === 0 && (
              <EmptyState
                icon="ti-file-invoice"
                title="No open quotes"
                description="Start a new quote when you are ready."
                action={
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/portal/quotes/new')}>
                    Request a quote
                  </button>
                }
              />
            )}
            {quotes.map((o) => {
              const chip = quoteLifecycleChip(o.status, 'customer', {
                partiallyAccepted: o.partiallyAccepted,
                needsCustomerInfo: o.needsCustomerInfo,
                createdAt: o.createdAt,
                type: o.type,
              });
              return (
                <Link key={o.id} to={`/portal/quotes/${o.id}`} className="orow">
                  <div className="othumb">
                    <i className={`ti ${serviceTi(o.serviceType)}`} />
                  </div>
                  <div className="oinfo">
                    <div className="on">{o.name ?? 'Quote request'}</div>
                    <div className="om">
                      <span>{o.humanRef ?? o.id.slice(0, 6)}</span>
                      <span>{serviceCategoryLabel(o.serviceType)}</span>
                    </div>
                  </div>
                  <span className={chip.cls}>{chip.label}</span>
                  <div className="oprice">{money(o.priceCents)}</div>
                </Link>
              );
            })}
          </>
        )}

        {!isLoading && tab === 'revisions' && (
          <>
            {revisions.length === 0 && (
              <EmptyState icon="ti-refresh" title="No open revisions" description="Requested changes will show up here." />
            )}
            {revisions.map((e) => (
              <Link key={e.id} to={`/portal/orders/${e.orderId}`} className="orow">
                <div className="othumb">
                  <i className="ti ti-refresh" />
                </div>
                <div className="oinfo">
                  <div className="on">{e.orderName ?? 'Revision'}</div>
                  <div className="om">
                    <span>{e.orderRef ?? e.orderId.slice(0, 6)}</span>
                  </div>
                </div>
                <span className="portal-chip c-revision">In progress</span>
              </Link>
            ))}
          </>
        )}

        {!isLoading && tab === 'invoices' && (
          <>
            {unpaidInvoices.length === 0 && (
              <EmptyState icon="ti-receipt" title="No unpaid invoices" description="Open invoices will show up here." />
            )}
            {unpaidInvoices.map((inv) => (
              <Link key={inv.id} to="/portal/invoices" className="orow">
                <div className="othumb">
                  <i className="ti ti-receipt" />
                </div>
                <div className="oinfo">
                  <div className="on">{inv.coversText ?? 'Invoice'}</div>
                  <div className="om">
                    <span>{inv.status === 'PARTIAL' ? 'Partial' : 'Unpaid'}</span>
                  </div>
                </div>
                <span className="chip c-review">{inv.status === 'PARTIAL' ? 'Partial' : 'Unpaid'}</span>
                <div className="oprice">{money(inv.remainingCents ?? inv.amountCents)}</div>
              </Link>
            ))}
          </>
        )}
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Recent Activity</h3>
            <p className="panel-sub">Your latest order, quote, revision and payment updates.</p>
          </div>
          {activityPages > 1 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setActivityPage((p) => (p < activityPages ? p + 1 : 1))}
            >
              View all activity
            </button>
          )}
        </div>
        {activityLoading && <SkeletonRows rows={3} />}
        {!activityLoading && activities.length === 0 && (
          <EmptyState icon="ti-bell" title="No recent activity" description="Updates will appear here as work moves along." />
        )}
        {activities.map((n) => {
          const action = activityAction(n.title, n.link);
          const unread = !n.readAt;
          return (
            <div key={n.id} className={`activity-row${unread ? ' is-unread' : ''}`}>
              <div className="activity-icon">
                <i className={`ti ${n.title.toLowerCase().includes('message') ? 'ti-message' : 'ti-bell'}`} />
              </div>
              <div className="oinfo">
                <div className="on">
                  {n.title}
                  {unread && <span className="activity-unread">Unread</span>}
                </div>
                <div className="om">
                  {n.body ? <span>{n.body}</span> : null}
                  <span className="activity-time">{relativeTime(n.createdAt)}</span>
                </div>
              </div>
              {action && (
                <Link
                  to={action.to}
                  className="activity-link"
                  onClick={() => {
                    if (!unread) return;
                    void markNotificationRead(n.id).then(() => {
                      void qc.invalidateQueries({ queryKey: ['my-activity'] });
                      void qc.invalidateQueries({ queryKey: ['notifications'] });
                    });
                  }}
                >
                  {action.label} <i className="ti ti-chevron-right" />
                </Link>
              )}
            </div>
          );
        })}
        {activityPages > 1 && (
          <div className="activity-pager">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={activityPage <= 1}
              onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>
              Page {activityPage} of {activityPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={activityPage >= activityPages}
              onClick={() => setActivityPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
