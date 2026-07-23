import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyWork } from '@/lib/team';
import { dateShort } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { OrderStatus } from '@/lib/types';

type WorkFilter = 'active' | 'submitted';

function statusChip(status: OrderStatus) {
  if (status === 'READY_TO_SEND') return 'chip c-review';
  if (status === 'IN_PROGRESS' || status === 'REVISION_REQUESTED') return 'chip c-prog';
  return 'chip c-assigned';
}

function statusText(status: OrderStatus) {
  if (status === 'READY_TO_SEND') return 'Submitted';
  if (status === 'IN_PROGRESS') return 'In progress';
  if (status === 'REVISION_REQUESTED') return 'Revision';
  return 'Assigned';
}

export function AdminMyWork() {
  const [filter, setFilter] = useState<WorkFilter>('active');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-mywork'],
    queryFn: listMyWork,
    refetchInterval: 30_000,
  });

  const orders = useMemo(() => {
    const all = data?.orders ?? [];
    if (filter === 'submitted') return all.filter((o) => o.status === 'READY_TO_SEND');
    return all.filter((o) => o.status !== 'READY_TO_SEND');
  }, [data?.orders, filter]);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>My work</h1>
          <div className="sub">
            Orders assigned to you. Open one to see everything you need, do the design, and submit it for approval.
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-briefcase" /> Assigned to me
          </span>
          <div className="filters">
            <button
              type="button"
              className={filter === 'active' ? 'on' : ''}
              onClick={() => setFilter('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={filter === 'submitted' ? 'on' : ''}
              onClick={() => setFilter('submitted')}
            >
              Submitted
            </button>
          </div>
        </div>

        {isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>}
        {!isLoading && orders.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>Nothing on your plate right now.</div>
        )}
        {orders.map((o) => (
          <Link
            key={o.id}
            to={`/admin/orders/${o.id}`}
            className="orow"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className={`othumb ${serviceThumbClass('embroidery')}`}>
              <i className={`ti ${serviceTi('embroidery')}`} />
            </div>
            <div className="oinfo">
              <div className="on">{o.name ?? 'Order'}</div>
              <div className="om">
                <span>
                  <i className="ti ti-hash" style={{ fontSize: 11 }} />
                  {o.humanRef ?? o.id.slice(0, 6)}
                </span>
                <span>{o.customerName ?? 'Customer'}</span>
                {o.dueDate && <span className="item-date">Due {dateShort(o.dueDate)}</span>}
              </div>
            </div>
            <span
              className={statusChip(o.status as OrderStatus)}
              style={
                o.status !== 'IN_PROGRESS' && o.status !== 'READY_TO_SEND'
                  ? { background: '#E3F2FD', color: '#1565c0' }
                  : undefined
              }
            >
              {statusText(o.status as OrderStatus)}
            </span>
            <div className="oprice" style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 500 }}>
              Open
            </div>
          </Link>
        ))}
      </div>

      <div className="note">
        <i className="ti ti-info-circle" /> You see the full order details and files, but not pricing or payment.
        When your file is ready, submit it — it goes to admin for approval before reaching the customer.
      </div>
    </div>
  );
}
