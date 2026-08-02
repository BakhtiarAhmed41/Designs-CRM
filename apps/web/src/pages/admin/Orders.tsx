import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { GenerateOrderModal } from '@/components/GenerateOrderModal';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { listAdminOrders } from '@/lib/orders';
import { money, dateShort, statusChipClass, statusLabel } from '@/lib/format';
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
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function customerLabel(o: Order & { customerName?: string | null }) {
  if (o.customerName) return o.customerName;
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

export function AdminOrders() {
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
  });

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Orders</h1>
          <div className="sub">Search, filter and manage production orders.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setGenOpen(true)}>
          <i className="ti ti-plus" /> Create new order
        </button>
      </div>

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

      <div className="card">
        {isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading…</div>}
        {!isLoading && orders.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No orders match.</div>
        )}
        {orders.map((o) => (
          <Link key={o.id} to={`/admin/orders/${o.id}`} className="crow" style={{ textDecoration: 'none' }}>
            <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
              <i className={`ti ${serviceTi(o.serviceType)}`} />
            </div>
            <div className="oinfo">
              <div className="on">{o.name || o.humanRef || 'Order'}</div>
              <div className="om">
                <span>{o.humanRef || o.id.slice(0, 8)}</span>
                <span>{customerLabel(o)}</span>
                <span>{dateShort(o.createdAt)}</span>
              </div>
            </div>
            <span className={statusChipClass(o.status as OrderStatus)}>
              {statusLabel(o.status as OrderStatus)}
            </span>
            <div className="oprice">{money(o.priceCents)}</div>
          </Link>
        ))}
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
