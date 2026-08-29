import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createOrder, getMyOrder, listMyOrders } from '@/lib/orders';
import { listMyEdits, requestEdit } from '@/lib/edits';
import { RevisionRequestForm } from '@/components/RevisionRequestForm';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort, lifecycleChip } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import type { Design } from '@/lib/designs';
import type { Order } from '@/lib/types';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { PageHeader } from '@/components/ui/PageHeader';

type OrderFilter = 'all' | 'active' | 'delivered';

const DONE = ['COMPLETED', 'CLOSED'];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  if (key === 'all') return 'All time';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function orderChip(o: Order, designs?: Design[]): { cls: string; label: string } {
  if (DONE.includes(o.status)) return { cls: 'chip c-done', label: 'Delivered' };
  if (['REVISION_REQUESTED', 'PENDING_PAYMENT'].includes(o.status)) {
    return lifecycleChip(o.status, 'customer');
  }
  if (o.partiallyDelivered) {
    return { cls: 'chip c-prog', label: 'Partially delivered' };
  }
  if (designs && designs.length > 1) {
    const delivered = designs.filter((d) => d.status === 'DELIVERED').length;
    if (delivered > 0 && delivered < designs.length) {
      return { cls: 'chip c-prog', label: 'Partially delivered' };
    }
  }
  return lifecycleChip(o.status, 'customer', {
    partiallyAccepted: o.partiallyAccepted,
    partiallyDelivered: o.partiallyDelivered,
  });
}

function designLineIcon(status: Design['status']) {
  if (status === 'DELIVERED' || status === 'DONE') {
    return { icon: 'ti-check', color: 'var(--green)' };
  }
  if (status === 'WAITING') return { icon: 'ti-alert-circle', color: 'var(--amber)' };
  return { icon: 'ti-loader', color: 'var(--navy)' };
}

function designChip(status: Design['status']) {
  if (status === 'DELIVERED' || status === 'DONE') return { cls: 'chip c-done', label: 'Delivered' };
  if (status === 'WAITING') return { cls: 'chip c-wait', label: 'Waiting on you' };
  return { cls: 'chip c-prog', label: 'Digitizing' };
}

function OrderBatch({ orderId, open }: { orderId: string; open: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [revOpen, setRevOpen] = useState(false);
  const [revNote, setRevNote] = useState('');
  const [revDesignIds, setRevDesignIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ['my-order', orderId],
    queryFn: () => getMyOrder(orderId),
    enabled: open,
  });

  const editsQ = useQuery({
    queryKey: ['my-order-edits', orderId],
    queryFn: () => listMyEdits(orderId),
    enabled: open,
  });

  const revMut = useMutation({
    mutationFn: (designIds: string[]) => requestEdit(orderId, revNote.trim(), designIds),
    onSuccess: () => {
      setRevOpen(false);
      setRevNote('');
      setRevDesignIds([]);
      setActionError(null);
      void invalidateWorkCaches(qc);
      void qc.invalidateQueries({ queryKey: ['my-order-edits', orderId] });
    },
    onError: (e) => setActionError(getErrorMessage(e)),
  });

  const designs = (data?.order as { designs?: Design[] } | undefined)?.designs ?? [];
  const order = data?.order;
  const isDelivered = DONE.includes(order?.status ?? '');
  const openRevision = (editsQ.data?.edits ?? []).find((e) => e.status === 'PENDING');
  const revisionIds = openRevision?.designIds ?? [];
  const canRequestRevision =
    isDelivered ||
    order?.status === 'REVISION_REQUESTED' ||
    designs.some((d) => d.status === 'DELIVERED');

  async function handleReorder() {
    if (!order?.serviceType) return;
    setActionError(null);
    setActionBusy(true);
    try {
      const orderType = order.type === 'QUOTE_REQUEST' ? 'QUOTE_REQUEST' : 'ORDER';
      await createOrder({
        type: orderType,
        serviceType: order.serviceType,
        name: order.name,
        subCategory: order.subCategory ?? order.name,
        instructions: order.instructions,
        size: order.size,
        preferences: order.preferences,
      });
      await invalidateWorkCaches(qc);
      navigate('/portal/orders');
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setActionBusy(false);
    }
  }

  if (!open) return null;

  if (designs.length === 0 && !isDelivered) {
    return (
      <div className="batch">
        <div className="line">
          <span className="ln" style={{ color: 'var(--muted)' }}>
            No design breakdown yet.
          </span>
        </div>
      </div>
    );
  }

  const deliveredActions = canRequestRevision ? (
    <>
      {actionError && (
        <div className="alert-error" style={{ margin: '8px 0' }}>
          {actionError}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 10,
          justifyContent: 'flex-end',
          padding: '12px 0 6px',
          flexWrap: 'wrap',
        }}
      >
        {(isDelivered || designs.some((d) => d.status === 'DELIVERED')) && (
          <Link to="/portal/files" className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}>
            <i className="ti ti-download" /> Download files
          </Link>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            setRevOpen(true);
          }}
        >
          <i className="ti ti-edit" /> Request revision
        </button>
        {isDelivered && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={actionBusy}
            onClick={(e) => {
              e.stopPropagation();
              void handleReorder();
            }}
          >
            <i className="ti ti-refresh" /> {actionBusy ? 'Creating…' : 'Reorder'}
          </button>
        )}
      </div>
      {revOpen && (
        <RevisionRequestForm
          designs={designs}
          note={revNote}
          onNote={setRevNote}
          selectedIds={revDesignIds}
          onToggle={(id) =>
            setRevDesignIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
          onCancel={() => {
            setRevOpen(false);
            setRevNote('');
            setRevDesignIds([]);
          }}
          onSubmit={(ids) => revMut.mutate(ids)}
          pending={revMut.isPending}
        />
      )}
    </>
  ) : null;

  if (designs.length === 0) {
    return <div className="batch">{deliveredActions}</div>;
  }

  return (
    <div className="batch">
      {designs.map((d) => {
        const inRevision =
          Boolean(openRevision) &&
          (revisionIds.length === 0 || revisionIds.includes(d.id));
        const ic = designLineIcon(d.status);
        const chip = inRevision
          ? { cls: 'chip c-review', label: 'Revision requested' }
          : designChip(d.status);
        return (
          <div key={d.id} className="line">
            <span className="ln">
              <i className={`ti ${ic.icon}`} style={{ color: ic.color }} /> {d.name}
              {d.size ? ` (${d.size})` : ''}
            </span>
            <span className={chip.cls}>{chip.label}</span>
            <span className="lp">{money(d.priceCents)}</span>
          </div>
        );
      })}
      {deliveredActions}
    </div>
  );
}

export function PortalOrders() {
  const navigate = useNavigate();
  const [month, setMonth] = useState<string>('all');
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const months = useMemo(() => {
    const now = new Date();
    const keys = ['all'];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(monthKey(d));
    }
    return keys;
  }, []);

  const monthFrom = month === 'all' ? dateFrom : `${month}-01`;
  const monthTo =
    month === 'all'
      ? dateTo
      : (() => {
          const [y, m] = month.split('-').map(Number);
          const last = new Date(y, m, 0).getDate();
          return `${month}-${String(last).padStart(2, '0')}`;
        })();

  const { data, isLoading } = useQuery({
    queryKey: ['my-orders', q, status, filter, month, dateFrom, dateTo, page],
    queryFn: () =>
      listMyOrders({
        type: 'ORDER',
        status: status || undefined,
        lifecycle: filter === 'all' ? undefined : filter,
        q: q.trim() || undefined,
        dateFrom: monthFrom || undefined,
        dateTo: monthTo || undefined,
        page,
        pageSize: 10,
      }),
    ...freshOnOpen,
  });

  const pageItems = data?.orders ?? [];
  const totalPages = data?.totalPages ?? 1;
  const summary = {
    count: data?.total ?? 0,
    designs: data?.designs ?? 0,
    delivered: data?.delivered ?? 0,
    total: data?.totalCents ?? 0,
  };

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Active production and delivered work. Filter by month or status."
      />

      <ListToolbar
        search={q}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search by name or order #…"
        status={status}
        onStatus={(v) => {
          setStatus(v);
          setPage(1);
        }}
        statusOptions={[
          { value: '', label: 'All statuses' },
          { value: 'IN_PROGRESS', label: 'In progress' },
          { value: 'READY_TO_SEND', label: 'Ready to send' },
          { value: 'REVISION_REQUESTED', label: 'Revision requested' },
          { value: 'PENDING_PAYMENT', label: 'Pending payment' },
          { value: 'COMPLETED', label: 'Delivered' },
          { value: 'CLOSED', label: 'Closed' },
        ]}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFrom={(v) => {
          setDateFrom(v);
          setPage(1);
        }}
        onDateTo={(v) => {
          setDateTo(v);
          setPage(1);
        }}
      />

      <div className="period-bar">
        <span className="plabel">Period</span>
        <div className="month-pills">
          {months.map((m) => (
            <button
              key={m}
              type="button"
              className={`mpill${m === 'all' ? ' all' : ''}${month === m ? ' on' : ''}`}
              onClick={() => {
                setMonth(m);
                setPage(1);
              }}
            >
              {monthLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="period-sum">
        <div className="psum">
          <div className="pl">Orders</div>
          <div className="pv">{summary.count}</div>
        </div>
        <div className="psum">
          <div className="pl">Designs</div>
          <div className="pv">{summary.designs || 'None'}</div>
        </div>
        <div className="psum">
          <div className="pl">Delivered</div>
          <div className="pv">{summary.delivered}</div>
        </div>
        <div className="psum">
          <div className="pl">Total value</div>
          <div className="pv maroon">{money(summary.total)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">
            {monthLabel(month)} ({summary.count} order{summary.count === 1 ? '' : 's'})
          </span>
          <div className="filters">
            {(
              [
                ['all', 'All'],
                ['active', 'In progress'],
                ['delivered', 'Delivered'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={filter === k ? 'on' : undefined}
                onClick={() => {
                  setFilter(k);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && <SkeletonRows rows={5} />}
        {!isLoading && pageItems.length === 0 && (
          <EmptyState
            icon="ti-package"
            title="No orders in this view"
            description="Try another period or status, or start with a new quote."
          />
        )}

        {!isLoading && pageItems.length > 0 && (
          <table className="itable">
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Date</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((o) => {
                const open = expanded === o.id;
                const chip = orderChip(o);
                return (
                  <Fragment key={o.id}>
                    <tr className="click-row" onClick={() => navigate(`/portal/orders/${o.id}`)}>
                      <td>
                        <div className="cell-main">
                          <div className={`thumb${serviceThumbClass(o.serviceType) ? ' m' : ''}`}>
                            <i className={`ti ${serviceTi(o.serviceType)}`} />
                          </div>
                          <div>
                            <div className="on">{o.name ?? o.serviceType ?? 'Order'}</div>
                            <div className="om">{o.humanRef ?? o.id.slice(0, 6)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={chip.cls}>{chip.label}</span>
                      </td>
                      <td className="muted">{dateShort(o.createdAt)}</td>
                      <td className="num">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          {money(o.priceCents)}
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={open ? 'Hide details' : 'Show details'}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded((prev) => (prev === o.id ? null : o.id));
                            }}
                          >
                            <i className={`ti ${open ? 'ti-chevron-up' : 'ti-chevron-down'}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="expand-row">
                        <td colSpan={4}>
                          <OrderBatch orderId={o.id} open={open} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={data?.total ?? summary.count}
        onPage={setPage}
      />
    </div>
  );
}
