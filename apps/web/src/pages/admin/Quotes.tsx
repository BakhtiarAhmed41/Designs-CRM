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
import { clipDesignLabel, money, dateShort, quoteLifecycleChip, orderNumber, orderSlug } from '@/lib/format';
import { isAdminRecounter, isStaffCreatedOrder } from '@/lib/quoteHelpers';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import type { Order, OrderStatus } from '@/lib/types';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';

const SENT: OrderStatus[] = ['QUOTATION_PROVIDED'];

function customerLabel(o: Order) {
  const c = o.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function daysAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function AdminQuotes() {
  const navigate = useNavigate();
  const qc = useQueryClient();
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

  const approvedOnly = status === 'APPROVED';

  const { data, isLoading } = useQuery({
    queryKey: ['admin-quotes', q, status, dateFrom, dateTo, page],
    queryFn: () =>
      listAdminOrders({
        quotePipeline: true,
        q: q || undefined,
        status: approvedOnly ? 'APPROVED' : status || undefined,
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
            ? `Quotation ${orderNumber(order.humanRef)} Chat`
            : 'Quotation Chat',
        });
        convo = created.conversation;
      }
      const quoteRef = orderNumber(order.humanRef, order.id.slice(0, 6));
      const amount = order.priceCents != null ? money(order.priceCents) : 'your quote';
      return sendAdminMessage(
        convo.id,
        `Just checking in. Did you have any questions about quote ${quoteRef} (${amount})? Happy to adjust if needed.`,
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
    <div className="admin-quotes-page">
      <PageHeader
        title="Quotes"
        subtitle="Needs pricing, sent, approved, and declined in one pipeline."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/admin/quotes/new')}
          >
            <i className="ti ti-file-dollar" /> Generate quote
          </button>
        }
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
          { value: 'CREATED', label: 'New request' },
          { value: 'QUOTATION_PROVIDED', label: 'Awaiting customer' },
          { value: 'APPROVED', label: 'Approved' },
          { value: 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL', label: 'Counter pending' },
          { value: 'CLIENT_REJECTED_QUOTATION', label: 'Declined by customer' },
          { value: 'REJECTED', label: 'Declined by staff' },
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

      <div className="card table-card">
        {isLoading && <SkeletonRows rows={5} />}
        {!isLoading && quotes.length === 0 && (
          <EmptyState
            icon="ti-file-invoice"
            title="No quotes in this view"
            description="Try another status or search, or generate a quote from the dashboard."
          />
        )}
        {!isLoading && quotes.length > 0 && (
          <table className="itable">
            <thead>
              <tr>
                <th>Quote</th>
                <th className="ref-no">Quote no.</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Date</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((o) => {
                const approved = o.type === 'ORDER';
                const chip = approved
                  ? { cls: 'chip c-done', label: 'Approved' }
                  : quoteLifecycleChip(o.status, 'admin', {
                      partiallyAccepted: o.partiallyAccepted,
                      adminRecounter: isAdminRecounter(o.quotations),
                    });
                const slug = orderSlug(o.humanRef, o.id);
                const project = clipDesignLabel(o.name ?? 'Quote request');
                return (
                  <tr
                    key={o.id}
                    className="click-row"
                    onClick={() => navigate(`/admin/quotes/${slug}`)}
                  >
                    <td className="ref-name">
                      <div className="cell-main">
                        <div className={`othumb ${serviceThumbClass(o.serviceType)}`}>
                          <i className={`ti ${serviceTi(o.serviceType)}`} />
                        </div>
                        <div>
                          <div className="on" title={project.full}>{project.text}</div>
                          {isStaffCreatedOrder(o) && <div className="om">Admin created</div>}
                        </div>
                      </div>
                    </td>
                    <td className="ref-no">{orderNumber(o.humanRef, o.id.slice(0, 6))}</td>
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
                    {orderNumber(o.humanRef, o.id.slice(0, 6))}
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
