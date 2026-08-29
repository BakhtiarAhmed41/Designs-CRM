import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { GenerateOrderModal } from '@/components/GenerateOrderModal';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAdminOrders } from '@/lib/orders';
import { freshOnOpen } from '@/lib/queryRefresh';
import { money, dateShort, lifecycleChip } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { Order, OrderStatus } from '@/lib/types';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'CREATED', label: 'New / draft' },
  { value: 'WAITING_FOR_QUOTATION', label: 'Waiting quotation' },
  { value: 'PENDING_PAYMENT', label: 'Pending payment' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'READY_TO_SEND', label: 'Ready to send' },
  { value: 'REVISION_REQUESTED', label: 'Revision requested' },
  { value: 'COMPLETED', label: 'Delivered' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REJECTED', label: 'Rejected' },
];

function customerLabel(o: Order & { customerName?: string | null }) {
  if (o.customerName) return o.customerName;
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

export function AdminOrders() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [genOpen, setGenOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-orders', q, status, dateFrom, dateTo, page],
    queryFn: () =>
      listAdminOrders({
        type: 'ORDER',
        q: q || undefined,
        status: status || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: 20,
      }),
    ...freshOnOpen,
  });

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Find a job in seconds. Search, filter, then open the workspace."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setGenOpen(true)}>
            <i className="ti ti-plus" /> Create order
          </button>
        }
      />

      <ListToolbar
        search={q}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search by name, order #, customer…"
        status={status}
        onStatus={(v) => {
          setStatus(v);
          setPage(1);
        }}
        statusOptions={STATUS_OPTIONS}
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

      <div className="card table-card">
        {isLoading && <SkeletonRows rows={6} />}
        {!isLoading && orders.length === 0 && (
          <EmptyState
            icon="ti-package"
            title="No orders match"
            description="Adjust search or filters, or create a new order."
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setGenOpen(true)}>
                Create order
              </button>
            }
          />
        )}
        {!isLoading && orders.length > 0 && (
          <table className="itable">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Date</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const chip = lifecycleChip(o.status as OrderStatus, 'admin', {
                  partiallyAccepted: o.partiallyAccepted,
                  partiallyDelivered: o.partiallyDelivered,
                });
                return (
                  <tr key={o.id} className="click-row" onClick={() => navigate(`/admin/orders/${o.id}`)}>
                    <td>
                      <div className="cell-main">
                        <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
                          <i className={`ti ${serviceTi(o.serviceType)}`} />
                        </div>
                        <div>
                          <div className="on">{o.name || o.humanRef || 'Order'}</div>
                          <div className="om">{o.humanRef || o.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td>{customerLabel(o)}</td>
                    <td>
                      <span className={chip.cls}>{chip.label}</span>
                    </td>
                    <td className="muted">{dateShort(o.createdAt)}</td>
                    <td className="num">{money(o.priceCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <PaginationBar
        page={data?.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        total={data?.total ?? orders.length}
        onPage={setPage}
      />

      <GenerateOrderModal open={genOpen} onClose={() => setGenOpen(false)} defaultMode="ORDER" />
    </div>
  );
}
