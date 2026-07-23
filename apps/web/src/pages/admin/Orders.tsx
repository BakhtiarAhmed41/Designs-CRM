import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { GenerateOrderModal } from '@/components/GenerateOrderModal';
import { listAdminOrders } from '@/lib/orders';
import { money, dateShort, statusChipClass, statusLabel } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { Order, OrderStatus } from '@/lib/types';

type FilterId =
  | ''
  | OrderStatus
  | 'embroidery'
  | 'svg'
  | 'vector'
  | 'cnc';

const FILTERS: Array<{ id: FilterId; label: string; status?: OrderStatus }> = [
  { id: '', label: 'All' },
  { id: 'CREATED', label: 'New', status: 'CREATED' },
  { id: 'IN_PROGRESS', label: 'In progress', status: 'IN_PROGRESS' },
  { id: 'READY_TO_SEND', label: 'Ready to send', status: 'READY_TO_SEND' },
  { id: 'COMPLETED', label: 'Delivered', status: 'COMPLETED' },
  { id: 'embroidery', label: 'Embroidery' },
  { id: 'svg', label: 'SVG' },
  { id: 'vector', label: 'Vector' },
  { id: 'cnc', label: 'CNC/Laser' },
];

function customerLabel(o: Order) {
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function dateHeadLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function matchesService(o: Order, filter: FilterId) {
  const s = (o.serviceType ?? '').toLowerCase();
  if (filter === 'embroidery') return s.includes('embroid') || s.includes('digit');
  if (filter === 'svg') return s.includes('svg');
  if (filter === 'vector') return s.includes('vector');
  if (filter === 'cnc') return s.includes('cnc') || s.includes('laser');
  return true;
}

export function AdminOrders() {
  const [filter, setFilter] = useState<FilterId>('');
  const [genOpen, setGenOpen] = useState(false);
  const statusFilter = FILTERS.find((f) => f.id === filter)?.status;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-orders', statusFilter ?? ''],
    queryFn: () => listAdminOrders(statusFilter ? { status: statusFilter } : undefined),
  });

  const orders = useMemo(() => {
    const all = (data?.orders ?? []).filter((o) => o.type !== 'QUOTE_REQUEST');
    if (['embroidery', 'svg', 'vector', 'cnc'].includes(filter)) {
      return all.filter((o) => matchesService(o, filter));
    }
    return all;
  }, [data?.orders, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders) {
      const key = new Date(o.createdAt).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return [...map.entries()].sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime(),
    );
  }, [orders]);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Orders</h1>
          <div className="sub">
            Grouped by date. Thumbnail, customer, status and price at a glance.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setGenOpen(true)}>
          <i className="ti ti-plus" /> Generate order
        </button>
      </div>

      <div style={{ margin: '16px 0 10px' }}>
        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              className={filter === f.id ? 'on' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>
        )}
        {!isLoading && orders.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No orders match this filter.</div>
        )}
        {grouped.map(([dayKey, dayOrders]) => (
          <div key={dayKey}>
            <div className="date-head">
              {dateHeadLabel(dayOrders[0].createdAt)}{' '}
              <span className="dcount">{dayOrders.length}</span>
            </div>
            {dayOrders.map((o) => (
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
                    <span className="item-date">{dateShort(o.createdAt)}</span>
                  </div>
                </div>
                <span className={statusChipClass(o.status)}>{statusLabel(o.status)}</span>
                <div className="oprice">{money(o.priceCents)}</div>
              </Link>
            ))}
          </div>
        ))}
      </div>

      <GenerateOrderModal open={genOpen} onClose={() => setGenOpen(false)} defaultMode="ORDER" />
    </div>
  );
}
