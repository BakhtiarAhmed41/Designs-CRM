import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyWork } from '@/lib/team';
import { freshOnOpen } from '@/lib/queryRefresh';
import { dateShort } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { OrderStatus } from '@/lib/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PaginationBar } from '@/components/lists/ListToolbar';

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
  const navigate = useNavigate();
  const [filter, setFilter] = useState<WorkFilter>('active');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-mywork'],
    queryFn: listMyWork,
    ...freshOnOpen,
    refetchInterval: 30_000,
  });

  const orders = useMemo(() => {
    const all = data?.orders ?? [];
    if (filter === 'submitted') return all.filter((o) => o.status === 'READY_TO_SEND');
    return all.filter((o) => o.status !== 'READY_TO_SEND');
  }, [data?.orders, filter]);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const paged = orders.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        title="My work"
        subtitle="What you need to work on right now: assigned, active, and submitted."
      />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-briefcase" /> Assigned to me
          </span>
          <div className="filters">
            <button
              type="button"
              className={filter === 'active' ? 'on' : ''}
              onClick={() => { setFilter('active'); setPage(1); }}
            >
              Active
            </button>
            <button
              type="button"
              className={filter === 'submitted' ? 'on' : ''}
              onClick={() => { setFilter('submitted'); setPage(1); }}
            >
              Submitted
            </button>
          </div>
        </div>

        {isLoading && <SkeletonRows rows={4} />}
        {!isLoading && orders.length === 0 && (
          <EmptyState
            icon="ti-briefcase"
            title={filter === 'submitted' ? 'Nothing submitted' : 'Nothing on your plate'}
            description={
              filter === 'submitted'
                ? 'Jobs you submit for review will show here.'
                : 'New assignments will appear here. You’re caught up.'
            }
          />
        )}
        {!isLoading && orders.length > 0 && (
          <table className="itable">
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((o) => (
                <tr key={o.id} className="click-row" onClick={() => navigate(`/admin/orders/${o.id}`)}>
                  <td>
                    <div className="cell-main">
                      <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
                        <i className={`ti ${serviceTi(o.serviceType)}`} />
                      </div>
                      <div>
                        <div className="on">{o.name ?? 'Order'}</div>
                        <div className="om">{o.humanRef ?? o.id.slice(0, 6)}</div>
                      </div>
                    </div>
                  </td>
                  <td>{o.customerName ?? 'Customer'}</td>
                  <td className="muted">{o.dueDate ? dateShort(o.dueDate) : 'None'}</td>
                  <td>
                    <span
                      className={statusChip(o.status as OrderStatus)}
                      style={
                        o.status !== 'IN_PROGRESS' && o.status !== 'READY_TO_SEND'
                          ? { background: 'var(--tint)', color: 'var(--navy)' }
                          : undefined
                      }
                    >
                      {statusText(o.status as OrderStatus)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <PaginationBar page={page} totalPages={totalPages} total={orders.length} onPage={setPage} />

      <div className="note">
        <i className="ti ti-info-circle" /> You see the full order details and files, but not pricing or payment.
        When your file is ready, submit it. It goes to admin for approval before reaching the customer.
      </div>
    </div>
  );
}
