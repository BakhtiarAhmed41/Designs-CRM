import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DateRangeBar } from '@/components/ui/DateRangeBar';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { getDashboardStats } from '@/lib/dashboard';
import { datesForPreset, inDateRange, type RangePreset } from '@/lib/dateRange';
import { listAdminEdits } from '@/lib/edits';
import { listAdminOrders } from '@/lib/orders';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import {
  clipDesignLabel,
  money,
  dateShort,
  lifecycleChip,
  quoteLifecycleChip,
  orderNumber,
  orderSlug,
} from '@/lib/format';
import { serviceWorkLabel } from '@/lib/serviceIcon';
import { canFeature } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import type { FeatureKey, Order, OrderStatus } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

type WorkTab = 'orders' | 'quotes' | 'edits';

const ACTIVE_ORDER_STATUSES = [
  'CREATED',
  'PENDING_PAYMENT',
  'IN_PROGRESS',
  'READY_TO_SEND',
  'REVISION_REQUESTED',
];

function customerLabel(o: Order) {
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

export function AdminDashboard() {
  const { user } = useAuth();
  const can = (key: FeatureKey) => canFeature(user?.permissions, key, user?.role);
  const navigate = useNavigate();
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
        statuses: ACTIVE_ORDER_STATUSES,
        page: 1,
        pageSize: 5,
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
        statuses: [
          'CREATED',
          'WAITING_FOR_QUOTATION',
          'WAITING_FOR_ADMIN_QUOTATION_APPROVAL',
          'QUOTATION_PROVIDED',
        ],
        page: 1,
        pageSize: 5,
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
    const list: Array<{
      id: WorkTab;
      label: string;
      count: number;
      to: string;
      viewAll: string;
      show: boolean;
      noun: string;
    }> = [
      {
        id: 'orders',
        label: 'Orders',
        count: orders.length,
        to: '/admin/orders',
        viewAll: 'View all orders',
        show: showOrders,
        noun: 'orders',
      },
      {
        id: 'quotes',
        label: 'Quotes',
        count: quoteOrders.length,
        to: '/admin/quotes',
        viewAll: 'View all quotes',
        show: showQuotes,
        noun: 'quotes',
      },
      {
        id: 'edits',
        label: 'Revisions',
        count: edits.length,
        to: '/admin/edits',
        viewAll: 'View all revisions',
        show: showEdits,
        noun: 'revisions',
      },
    ];
    return list.filter((t) => t.show);
  }, [edits.length, orders.length, quoteOrders.length, showEdits, showOrders, showQuotes]);

  const activeTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? 'orders');
  const activeMeta = tabs.find((t) => t.id === activeTab);
  const activeRows =
    activeTab === 'orders'
      ? orders.length
      : activeTab === 'quotes'
        ? quoteOrders.length
        : edits.length;

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
                onClick={() => navigate('/admin/quotes/new')}
              >
                <i className="ti ti-file-dollar" /> Generate quote
              </button>
            )}
            {can('orders') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/admin/orders/new')}
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
      )}

      {tabs.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Active work</h3>
              <p className="panel-sub">
                Manage your active orders, quotes, and revisions.
              </p>
            </div>
          </div>

          <div className="dash-work-bar">
            <label className="dash-work-filter">
              <span>Filter</span>
              <SelectMenu
                size="compact"
                ariaLabel="Active work filter"
                value={activeTab}
                onChange={(value) => setTab(value as WorkTab)}
                options={tabs.map((t) => ({
                  value: t.id,
                  label: `${t.label} (${t.count})`,
                }))}
              />
            </label>
            {activeMeta && (
              <Link to={activeMeta.to} className="btn btn-ghost btn-sm">
                {activeMeta.viewAll}
              </Link>
            )}
          </div>

          {activeTab === 'orders' && (
            <>
              {orders.length === 0 && (
                <EmptyState
                  icon="ti-package"
                  title="No orders yet"
                  description="New orders in this range will show up here."
                />
              )}
              {orders.length > 0 && (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <colgroup>
                      <col className="dash-col-customer" />
                      <col className="dash-col-project" />
                      <col className="dash-col-id" />
                      <col className="dash-col-cat" />
                      <col className="dash-col-status" />
                      <col className="dash-col-date" />
                      <col className="dash-col-amount" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Design</th>
                        <th>Order no.</th>
                        <th>Service</th>
                        <th>Status</th>
                        <th>Placed</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const chip = lifecycleChip(o.status as OrderStatus, 'admin', {
                          partiallyAccepted: o.partiallyAccepted,
                          partiallyDelivered: o.partiallyDelivered,
                          fullyDelivered: o.fullyDelivered,
                          revisionPartial: o.revisionPartial,
                        });
                        const project = clipDesignLabel(o.name ?? o.serviceType ?? 'Order');
                        const href = `/admin/orders/${orderSlug(o.humanRef, o.id)}`;
                        return (
                          <tr
                            key={o.id}
                            className="click-row"
                            onClick={() => navigate(href)}
                          >
                            <td>{customerLabel(o)}</td>
                            <td className="dash-project">
                              <div className="on" title={project.full}>
                                {project.text}
                              </div>
                            </td>
                            <td>
                              <Link
                                to={href}
                                className="dash-ref"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {orderNumber(o.humanRef, o.id.slice(0, 6))}
                              </Link>
                            </td>
                            <td className="muted">{serviceWorkLabel(o.serviceType)}</td>
                            <td>
                              <span className={chip.cls}>{chip.label}</span>
                            </td>
                            <td className="muted">{dateShort(o.createdAt)}</td>
                            <td>{money(o.priceCents)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === 'quotes' && (
            <>
              {quoteOrders.length === 0 && (
                <EmptyState
                  icon="ti-file-invoice"
                  title="No quotes waiting"
                  description="Quotes that need a price will land here."
                />
              )}
              {quoteOrders.length > 0 && (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <colgroup>
                      <col className="dash-col-customer" />
                      <col className="dash-col-project" />
                      <col className="dash-col-id" />
                      <col className="dash-col-cat" />
                      <col className="dash-col-date" />
                      <col className="dash-col-status" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Design</th>
                        <th>Quote no.</th>
                        <th>Service</th>
                        <th>Submitted</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteOrders.map((o) => {
                        const chip = quoteLifecycleChip(o.status, 'admin', {
                          partiallyAccepted: o.partiallyAccepted,
                          needsCustomerInfo: o.needsCustomerInfo,
                          createdAt: o.createdAt,
                          type: o.type,
                        });
                        const project = clipDesignLabel(o.name ?? 'Quote request');
                        const href = `/admin/quotes/${orderSlug(o.humanRef, o.id)}`;
                        return (
                          <tr
                            key={o.id}
                            className="click-row"
                            onClick={() => navigate(href)}
                          >
                            <td>{customerLabel(o)}</td>
                            <td className="dash-project">
                              <div className="on" title={project.full}>
                                {project.text}
                              </div>
                            </td>
                            <td>
                              <Link
                                to={href}
                                className="dash-ref"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {orderNumber(o.humanRef, o.id.slice(0, 6))}
                              </Link>
                            </td>
                            <td className="muted">{serviceWorkLabel(o.serviceType)}</td>
                            <td className="muted">{dateShort(o.createdAt)}</td>
                            <td>
                              <span className={chip.cls}>{chip.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === 'edits' && (
            <>
              {edits.length === 0 && (
                <EmptyState
                  icon="ti-refresh"
                  title="No open revisions"
                  description="Revisions in this range will land here."
                />
              )}
              {edits.length > 0 && (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <colgroup>
                      <col className="dash-col-project" />
                      <col className="dash-col-id" />
                      <col className="dash-col-date" />
                      <col className="dash-col-status" />
                      <col className="dash-col-amount" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Design</th>
                        <th>Order no.</th>
                        <th>Requested</th>
                        <th>Status</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {edits.slice(0, 5).map((e) => {
                        const project = clipDesignLabel(e.orderName ?? 'Revision');
                        const href = `/admin/orders/${orderSlug(e.orderRef, e.orderId)}`;
                        const statusLabel =
                          e.status === 'PENDING'
                            ? e.readyAt
                              ? 'In progress'
                              : 'Needs revision'
                            : 'Done';
                        const statusCls =
                          e.status === 'PENDING'
                            ? e.readyAt
                              ? 'chip c-prog'
                              : 'chip c-quote'
                            : 'chip c-done';
                        return (
                          <tr
                            key={e.id}
                            className="click-row"
                            onClick={() => navigate(href)}
                          >
                            <td className="dash-project">
                              <div className="on" title={project.full}>
                                {project.text}
                              </div>
                            </td>
                            <td>
                              <Link
                                to={href}
                                className="dash-ref"
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                {orderNumber(e.orderRef, e.orderId.slice(0, 6))}
                              </Link>
                            </td>
                            <td className="muted">{dateShort(e.createdAt)}</td>
                            <td>
                              <span className={statusCls}>{statusLabel}</span>
                            </td>
                            <td>{e.kind === 'PAID' ? money(e.priceCents) : 'Free'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeMeta && activeRows > 0 && (
            <div className="dash-work-foot">
              Showing {Math.min(activeRows, 5)} active {activeMeta.noun}.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
