import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createOrder, getMyOrder, listMyOrders } from '@/lib/orders';
import { requestEdit } from '@/lib/edits';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import type { Design } from '@/lib/designs';
import type { Order } from '@/lib/types';

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
    return { cls: 'chip c-wait', label: 'Waiting on you' };
  }
  if (designs && designs.length > 0) {
    const done = designs.filter((d) => d.status === 'DELIVERED' || d.status === 'DONE').length;
    if (done > 0 && done < designs.length) {
      return { cls: 'chip c-prog', label: `${done} of ${designs.length} done` };
    }
  }
  if (o.status === 'IN_PROGRESS' || o.status === 'READY_TO_SEND') {
    return { cls: 'chip c-prog', label: 'In progress' };
  }
  return { cls: 'chip c-prog', label: 'In progress' };
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ['my-order', orderId],
    queryFn: () => getMyOrder(orderId),
    enabled: open,
  });

  const revMut = useMutation({
    mutationFn: (note: string) => requestEdit(orderId, note),
    onSuccess: () => {
      setRevOpen(false);
      setRevNote('');
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['my-orders'] });
      qc.invalidateQueries({ queryKey: ['my-order', orderId] });
    },
    onError: (e) => setActionError(getErrorMessage(e)),
  });

  const designs = (data?.order as { designs?: Design[] } | undefined)?.designs ?? [];
  const order = data?.order;
  const isDelivered = DONE.includes(order?.status ?? '');

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
      await qc.invalidateQueries({ queryKey: ['my-orders'] });
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

  const deliveredActions = isDelivered ? (
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
        <Link to="/portal/files" className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}>
          <i className="ti ti-download" /> Download files
        </Link>
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
      </div>
      {revOpen && (
        <div
          style={{
            borderTop: '0.5px solid var(--line)',
            paddingTop: 12,
            marginTop: 4,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>
            What should we change?
          </label>
          <textarea
            value={revNote}
            onChange={(e) => setRevNote(e.target.value)}
            placeholder="Describe the revision you need…"
            rows={3}
            style={{
              width: '100%',
              border: '0.5px solid var(--line)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setRevOpen(false);
                setRevNote('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!revNote.trim() || revMut.isPending}
              onClick={() => revMut.mutate(revNote.trim())}
            >
              {revMut.isPending ? 'Sending…' : 'Submit revision request'}
            </button>
          </div>
        </div>
      )}
    </>
  ) : null;

  if (designs.length === 0) {
    return <div className="batch">{deliveredActions}</div>;
  }

  return (
    <div className="batch">
      {designs.map((d) => {
        const ic = designLineIcon(d.status);
        const chip = designChip(d.status);
        return (
          <div key={d.id} className="line">
            <span className="ln">
              <i className={`ti ${ic.icon}`} style={{ color: ic.color }} /> {d.name}
              {d.size ? ` — ${d.size}` : ''}
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
  const [month, setMonth] = useState<string>('all');
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-orders'],
    queryFn: listMyOrders,
  });

  const orders = useMemo(
    () => (data?.orders ?? []).filter((o) => o.type === 'ORDER'),
    [data],
  );

  const months = useMemo(() => {
    const keys = new Set<string>();
    for (const o of orders) {
      keys.add(monthKey(new Date(o.createdAt)));
    }
    return ['all', ...Array.from(keys).sort().reverse()];
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (month !== 'all') {
      list = list.filter((o) => monthKey(new Date(o.createdAt)) === month);
    }
    if (filter === 'active') {
      list = list.filter((o) => !DONE.includes(o.status));
    }
    if (filter === 'delivered') {
      list = list.filter((o) => DONE.includes(o.status));
    }
    return list;
  }, [orders, month, filter]);

  const summary = useMemo(() => {
    let designs = 0;
    let delivered = 0;
    let total = 0;
    for (const o of filtered) {
      total += o.priceCents ?? 0;
      if (DONE.includes(o.status)) delivered++;
    }
    return { count: filtered.length, designs, delivered, total };
  }, [filtered]);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Orders</h1>
          <div className="sub">
            Your active and completed orders. Filter by month to review your business over any
            period.
          </div>
        </div>
      </div>

      <div className="period-bar">
        <span className="plabel">Period</span>
        <div className="month-pills">
          {months.map((m) => (
            <button
              key={m}
              type="button"
              className={`mpill${m === 'all' ? ' all' : ''}${month === m ? ' on' : ''}`}
              onClick={() => setMonth(m)}
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
          <div className="pv">{summary.designs || '—'}</div>
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
            {monthLabel(month)} — {filtered.length} order{filtered.length === 1 ? '' : 's'}
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
                onClick={() => setFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && <div className="empty">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="empty">
            <i className="ti ti-package" />
            <p>No orders in this period.</p>
          </div>
        )}

        {filtered.map((o) => {
          const open = expanded === o.id;
          const chip = orderChip(o);
          return (
            <div key={o.id}>
              <div
                className="orow"
                onClick={() => setExpanded((prev) => (prev === o.id ? null : o.id))}
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
                    <span>{dateShort(o.createdAt)}</span>
                  </div>
                </div>
                <span className={chip.cls}>{chip.label}</span>
                <div className="oprice">{money(o.priceCents)}</div>
              </div>
              <OrderBatch orderId={o.id} open={open} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
