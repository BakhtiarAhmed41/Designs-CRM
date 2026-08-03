import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminRejectOrder, listAdminOrders } from '@/lib/orders';
import {
  createAdminConversation,
  listAdminConversations,
  sendAdminMessage,
} from '@/lib/messaging';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort, quoteLifecycleChip } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { Order, OrderStatus } from '@/lib/types';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';

type QuoteFilter = 'all' | 'needs' | 'sent' | 'urgent' | 'declined';

function customerLabel(o: Order) {
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function daysAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

const NEEDS: OrderStatus[] = ['WAITING_FOR_QUOTATION'];
const SENT: OrderStatus[] = ['QUOTATION_PROVIDED'];
const DECLINED: OrderStatus[] = [
  'CLIENT_REJECTED_QUOTATION',
  'REJECTED',
  'CANCELLED',
];

export function AdminQuotes() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<QuoteFilter>('all');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-quotes', q, status, dateFrom, dateTo, page],
    queryFn: () =>
      listAdminOrders({
        type: 'QUOTE_REQUEST',
        q: q || undefined,
        status: status || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: 20,
      }),
    refetchInterval: 30_000,
  });

  const allQuotes = useMemo(() => data?.orders ?? [], [data?.orders]);

  const quotes = useMemo(() => {
    switch (filter) {
      case 'needs':
        return allQuotes.filter((o) => NEEDS.includes(o.status));
      case 'sent':
        return allQuotes.filter((o) => SENT.includes(o.status));
      case 'urgent':
        return allQuotes.filter(
          (o) => NEEDS.includes(o.status) && daysAgo(o.createdAt) >= 2,
        );
      case 'declined':
        return allQuotes.filter((o) => DECLINED.includes(o.status));
      default:
        return allQuotes;
    }
  }, [allQuotes, filter]);

  const followUps = allQuotes.filter(
    (o) => SENT.includes(o.status) && daysAgo(o.updatedAt) >= 2,
  );

  function invalidateQuotes() {
    qc.invalidateQueries({ queryKey: ['admin-quotes'] });
    qc.invalidateQueries({ queryKey: ['admin-orders'] });
  }

  const nudgeMut = useMutation({
    mutationFn: async (order: Order) => {
      const listed = await listAdminConversations();
      let convo = listed.conversations.find((c) => c.orderId === order.id);
      if (!convo) {
        const created = await createAdminConversation({
          customerId: order.customerId ?? null,
          orderId: order.id,
          chatType: 'QUOTE',
          subject: order.humanRef
            ? `Quotation ${order.humanRef} Chat`
            : 'Quotation Chat',
        });
        convo = created.conversation;
      }
      const quoteRef = order.humanRef ?? order.id.slice(0, 6);
      const amount = order.priceCents != null ? money(order.priceCents) : 'your quote';
      return sendAdminMessage(
        convo.id,
        `Just checking in — did you have any questions about quote Q-${quoteRef} (${amount})? Happy to adjust if needed.`,
      );
    },
    onSuccess: () => {
      setError(null);
      setToast('Follow-up sent.');
      invalidateQuotes();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const expireMut = useMutation({
    mutationFn: (orderId: string) =>
      adminRejectOrder(orderId, {
        reason: 'Quote expired by staff',
        status: 'CANCELLED',
      }),
    onSuccess: () => {
      setError(null);
      setToast('Quote expired.');
      invalidateQuotes();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Quotes</h1>
          <div className="sub">
            Requests waiting for your price, and quotes you&apos;ve sent that are waiting on the customer.
          </div>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <ListToolbar
        search={q}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search by name, quote #, customer…"
        status={status}
        onStatus={(v) => {
          setStatus(v);
          setPage(1);
        }}
        statusOptions={[
          { value: '', label: 'All statuses' },
          { value: 'WAITING_FOR_QUOTATION', label: 'Needs pricing' },
          { value: 'QUOTATION_PROVIDED', label: 'Awaiting customer' },
          { value: 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL', label: 'Counter pending' },
          { value: 'CLIENT_REJECTED_QUOTATION', label: 'Declined by customer' },
          { value: 'REJECTED', label: 'Declined by staff' },
          { value: 'CREATED', label: 'Draft' },
          { value: 'CANCELLED', label: 'Expired' },
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

      <div style={{ margin: '0 0 10px' }}>
        <div className="filters">
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            All
          </button>
          <button type="button" className={filter === 'needs' ? 'on' : ''} onClick={() => setFilter('needs')}>
            Needs pricing
          </button>
          <button type="button" className={filter === 'sent' ? 'on' : ''} onClick={() => setFilter('sent')}>
            Sent — awaiting customer
          </button>
          <button type="button" className={filter === 'declined' ? 'on' : ''} onClick={() => setFilter('declined')}>
            Declined
          </button>
          <button type="button" className={filter === 'urgent' ? 'on' : ''} onClick={() => setFilter('urgent')}>
            Urgent
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>}
        {!isLoading && quotes.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No quotes match this filter.</div>
        )}
        {quotes.map((o) => (
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
                <span>
                  <i className="ti ti-hash" style={{ fontSize: 11 }} />
                  Q-{o.humanRef ?? o.id.slice(0, 6)}
                </span>
                <span>{customerLabel(o)}</span>
                <span className="item-date">{dateShort(o.createdAt)}</span>
              </div>
            </div>
            {(() => {
              const chip = quoteLifecycleChip(o.status, 'admin', {
                partiallyAccepted: o.partiallyAccepted,
              });
              return <span className={chip.cls}>{chip.label}</span>;
            })()}
            <div className="oprice">{money(o.priceCents)}</div>
          </Link>
        ))}
      </div>

      <PaginationBar
        page={data?.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        total={data?.total ?? quotes.length}
        onPage={setPage}
      />

      {followUps.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-clock" /> Follow-ups needed
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              Quotes awaiting a response for 2+ days
            </span>
          </div>
          {followUps.map((o) => (
            <div key={o.id} className="orow" style={{ cursor: 'default' }}>
              <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
                <i className={`ti ${serviceTi(o.serviceType)}`} />
              </div>
              <div className="oinfo">
                <div className="on">{o.name ?? 'Quote'}</div>
                <div className="om">
                  <span>
                    <i className="ti ti-hash" style={{ fontSize: 11 }} />
                    Q-{o.humanRef ?? o.id.slice(0, 6)}
                  </span>
                  <span>
                    Quoted {money(o.priceCents)} · sent {daysAgo(o.updatedAt)} days ago
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={nudgeMut.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    nudgeMut.mutate(o);
                  }}
                >
                  <i className="ti ti-bell" /> Nudge
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--maroon)' }}
                  disabled={expireMut.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    expireMut.mutate(o.id);
                  }}
                >
                  <i className="ti ti-x" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="toast show">
          <i className="ti ti-circle-check" /> {toast}
        </div>
      )}
    </div>
  );
}
