import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminRejectOrder, listAdminOrders } from '@/lib/orders';
import {
  createAdminConversation,
  listAdminConversations,
  sendAdminMessage,
} from '@/lib/messaging';
import { getErrorMessage } from '@/lib/api';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { money, dateShort, quoteLifecycleChip } from '@/lib/format';
import { isAdminRecounter } from '@/lib/quoteHelpers';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { Order, OrderStatus } from '@/lib/types';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';

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
  const navigate = useNavigate();
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

  const tabStatuses =
    filter === 'needs' || filter === 'urgent'
      ? NEEDS
      : filter === 'sent'
        ? SENT
        : filter === 'declined'
          ? DECLINED
          : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-quotes', filter, q, status, dateFrom, dateTo, page],
    queryFn: () =>
      listAdminOrders({
        type: 'QUOTE_REQUEST',
        q: q || undefined,
        status: filter === 'all' ? status || undefined : undefined,
        statuses: tabStatuses,
        olderThanDays: filter === 'urgent' ? 2 : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: 20,
      }),
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });

  const quotes = data?.orders ?? [];

  const followUpsQ = useQuery({
    queryKey: ['admin-quotes-followups'],
    queryFn: () =>
      listAdminOrders({
        type: 'QUOTE_REQUEST',
        statuses: SENT,
        updatedOlderThanDays: 2,
        page: 1,
        pageSize: 20,
      }),
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });
  const followUps = followUpsQ.data?.orders ?? [];

  function invalidateQuotes() {
    void invalidateWorkCaches(qc);
  }

  const nudgeMut = useMutation({
    mutationFn: async (order: Order) => {
      const listed = await listAdminConversations({ orderId: order.id });
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
        `Just checking in. Did you have any questions about quote Q-${quoteRef} (${amount})? Happy to adjust if needed.`,
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
      <PageHeader
        title="Quotes"
        subtitle="Needs pricing, sent, urgent, and declined in one pipeline."
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

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

      <div>
        <div className="filters">
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => { setFilter('all'); setPage(1); }}>
            All
          </button>
          <button type="button" className={filter === 'needs' ? 'on' : ''} onClick={() => { setFilter('needs'); setPage(1); }}>
            Needs pricing
          </button>
          <button type="button" className={filter === 'sent' ? 'on' : ''} onClick={() => { setFilter('sent'); setPage(1); }}>
            Sent, awaiting customer
          </button>
          <button type="button" className={filter === 'declined' ? 'on' : ''} onClick={() => { setFilter('declined'); setPage(1); }}>
            Declined
          </button>
          <button type="button" className={filter === 'urgent' ? 'on' : ''} onClick={() => { setFilter('urgent'); setPage(1); }}>
            Urgent
          </button>
        </div>
      </div>

      <div className="card table-card">
        {isLoading && <SkeletonRows rows={5} />}
        {!isLoading && quotes.length === 0 && (
          <EmptyState
            icon="ti-file-invoice"
            title="No quotes in this view"
            description="Try another tab or search, or generate a quote from the dashboard."
          />
        )}
        {!isLoading && quotes.length > 0 && (
          <table className="itable">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Date</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((o) => {
                const chip = quoteLifecycleChip(o.status, 'admin', {
                  partiallyAccepted: o.partiallyAccepted,
                  adminRecounter: isAdminRecounter(o.quotations),
                });
                return (
                  <tr key={o.id} className="click-row" onClick={() => navigate(`/admin/quotes/${o.id}`)}>
                    <td>
                      <div className="cell-main">
                        <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
                          <i className={`ti ${serviceTi(o.serviceType)}`} />
                        </div>
                        <div>
                          <div className="on">{o.name ?? 'Quote request'}</div>
                          <div className="om">Q-{o.humanRef ?? o.id.slice(0, 6)}</div>
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
