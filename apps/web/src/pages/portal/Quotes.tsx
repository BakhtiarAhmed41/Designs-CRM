import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { QuoteBuilderModal } from '@/components/QuoteBuilderModal';
import { acceptQuotation, listMyOrderSummary, listMyOrders, myAttachmentUrl, rejectQuotation } from '@/lib/orders';
import { createMyConversation, listMyConversations } from '@/lib/messaging';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { money, dateShort, quoteLifecycleChip } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import type { Order, Quotation } from '@/lib/types';
import type { QuotationLine } from '@/lib/designs';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { PageHeader } from '@/components/ui/PageHeader';

type QuoteWithLines = Quotation & { lines?: QuotationLine[] };

function isQuoteOrder(o: Order) {
  return (
    o.type === 'QUOTE_REQUEST' ||
    [
      'CREATED',
      'WAITING_FOR_QUOTATION',
      'QUOTATION_PROVIDED',
      'WAITING_FOR_ADMIN_QUOTATION_APPROVAL',
      'CLIENT_REJECTED_QUOTATION',
      'REJECTED',
      'CANCELLED',
    ].includes(o.status)
  );
}

function lineTotal(l: QuotationLine) {
  return (l.priceCents ?? 0) + l.sizes.reduce((s, sz) => s + (sz.priceCents ?? 0), 0);
}

export function PortalQuotes() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const incoming = (location.state as { claimError?: string } | null)?.claimError;
    if (!incoming) return;
    setError(incoming);
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate]);
  const [keptByOrder, setKeptByOrder] = useState<Record<string, string[]>>({});
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['my-quotes', q, status, dateFrom, dateTo, page],
    queryFn: () =>
      listMyOrders({
        type: 'QUOTE_REQUEST',
        status: status || undefined,
        q: q.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: 10,
      }),
    ...freshOnOpen,
  });
  const summaryQ = useQuery({
    queryKey: ['my-orders-summary'],
    queryFn: listMyOrderSummary,
    ...freshOnOpen,
  });

  const quotes = (data?.orders ?? []).filter((o) => isQuoteOrder(o));
  const totalPages = data?.totalPages ?? 1;
  const awaiting = summaryQ.data?.awaitingQuote ?? 0;
  const pricing = summaryQ.data?.beingPriced ?? 0;

  const approveMut = useMutation({
    mutationFn: ({ orderId, keepLineIds }: { orderId: string; keepLineIds?: string[] }) =>
      acceptQuotation(orderId, keepLineIds),
    onSuccess: () => {
      setError(null);
      void invalidateWorkCaches(qc);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const rejectMut = useMutation({
    mutationFn: (orderId: string) => rejectQuotation(orderId),
    onSuccess: () => {
      setError(null);
      void invalidateWorkCaches(qc);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const startQuoteChat = useMutation({
    mutationFn: async (order: Order) => {
      const listed = await listMyConversations();
      const existing = listed.conversations.find(
        (c) => c.orderId === order.id && c.chatType === 'QUOTE',
      );
      if (existing) return existing;
      const created = await createMyConversation({
        orderId: order.id,
        chatType: 'QUOTE',
        subject: order.humanRef
          ? `Quotation ${order.humanRef} Chat`
          : 'Quotation Chat',
      });
      return created.conversation;
    },
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (e) => setError(getErrorMessage(e)),
  });

  function keptLines(orderId: string, lines: QuotationLine[]) {
    const selected = keptByOrder[orderId];
    if (selected) return selected;
    return lines.map((l) => l.id);
  }

  function toggleLine(orderId: string, lines: QuotationLine[], lineId: string) {
    const current = keptLines(orderId, lines);
    const next = current.includes(lineId)
      ? current.filter((id) => id !== lineId)
      : [...current, lineId];
    setKeptByOrder((prev) => ({ ...prev, [orderId]: next }));
  }

  function selectedTotal(orderId: string, lines: QuotationLine[]) {
    const kept = new Set(keptLines(orderId, lines));
    return lines.filter((l) => kept.has(l.id)).reduce((sum, l) => sum + lineTotal(l), 0);
  }

  function toggle(id: string) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  return (
    <div>
      <PageHeader
        title="Quotes"
        subtitle="See our price, then approve to start, or message us to adjust."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setQuoteOpen(true)}>
            <i className="ti ti-plus" /> Request a quote
          </button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="metric-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Awaiting your approval</div>
          <div className={`mv${awaiting ? ' alert' : ''}`}>{awaiting}</div>
          <div className="md">Ready to review</div>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Being priced by us</div>
          <div className="mv">{pricing}</div>
          <div className="md">We’ll get back within a few hours</div>
        </div>
      </div>

      <ListToolbar
        search={q}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search quotes…"
        status={status}
        onStatus={(v) => {
          setStatus(v);
          setPage(1);
        }}
        statusOptions={[
          { value: '', label: 'All statuses' },
          { value: 'CREATED', label: 'Draft' },
          { value: 'WAITING_FOR_QUOTATION', label: 'Being priced' },
          { value: 'QUOTATION_PROVIDED', label: 'Quote ready' },
          { value: 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL', label: 'Counter pending' },
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

      <div className="card">
        <div className="card-h">
          <span className="ct">Your quotes</span>
        </div>
        {isLoading && <SkeletonRows rows={4} />}
        {!isLoading && quotes.length === 0 && (
          <EmptyState
            icon="ti-file-invoice"
            title="No quotes yet"
            description="Request a quote and we’ll price it. Approve to start production."
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setQuoteOpen(true)}>
                Request a quote
              </button>
            }
          />
        )}
        {quotes.map((o) => {
          const chip = quoteLifecycleChip(o.status, 'customer', {
            partiallyAccepted: o.partiallyAccepted,
          });
          const quote = o.quotations?.[0] as QuoteWithLines | undefined;
          const lines = quote?.lines ?? [];
          const total = quote?.amountCents ?? null;
          const open = expanded === o.id;
          const canApprove = o.status === 'QUOTATION_PROVIDED';
          const keep = keptLines(o.id, lines);
          const payTotal = lines.length > 0 ? selectedTotal(o.id, lines) : total;

          return (
            <div key={o.id}>
              <div
                className="orow"
                onClick={() => {
                  if (canApprove || lines.length > 0) {
                    toggle(o.id);
                    return;
                  }
                  navigate(`/portal/quotes/${o.id}`);
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className={`thumb${serviceThumbClass(o.serviceType) ? ' m' : ''}`}>
                  <i className={`ti ${serviceTi(o.serviceType)}`} />
                </div>
                <div className="oinfo">
                  <div className="on">{o.name ?? o.serviceType ?? 'Quote request'}</div>
                  <div className="om">
                    <span>
                      <i className="ti ti-hash" style={{ fontSize: 12 }} />
                      {o.humanRef ?? o.id.slice(0, 6)}
                    </span>
                    {lines.length > 0 && (
                      <span>
                        <i className="ti ti-files" style={{ fontSize: 12 }} />
                        {lines.length} design{lines.length === 1 ? '' : 's'}
                      </span>
                    )}
                    <span>Submitted {dateShort(o.createdAt)}</span>
                  </div>
                </div>
                <span className={chip.cls}>{chip.label}</span>
                <div className="oprice">
                  {total != null ? (
                    <>
                      {money(total, quote?.currency)}
                      {lines.length > 0 && (
                        <div className="os">{open ? 'tap to close' : 'tap to see breakdown'}</div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: 'var(--faint)', fontWeight: 500 }}>Pending</span>
                  )}
                </div>
              </div>

              {open && (lines.length > 0 || canApprove) && (
                <div className="batch">
                  {lines.map((l) => {
                    const checked = keep.includes(l.id);
                    return (
                      <div key={l.id} className="line">
                        <span className="ln">
                          {canApprove ? (
                            <label
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLine(o.id, lines, l.id)}
                              />
                              {l.name}
                            </label>
                          ) : (
                            <>
                              <i className="ti ti-point" /> {l.name}
                            </>
                          )}
                        </span>
                        {l.note && (
                          <span className="chip c-prog" style={{ opacity: 0.6 }}>
                            {l.note}
                          </span>
                        )}
                        {l.attachmentId && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              void downloadSignedFile(
                                myAttachmentUrl(o.id, l.attachmentId!),
                                l.name,
                              );
                            }}
                          >
                            <i className="ti ti-download" /> File
                          </button>
                        )}
                        <span
                          className="lp"
                          style={{ opacity: canApprove && !checked ? 0.4 : 1 }}
                        >
                          {money(lineTotal(l), quote?.currency)}
                        </span>
                      </div>
                    );
                  })}
                  {canApprove && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        justifyContent: 'flex-end',
                        padding: '12px 0 6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/portal/quotes/${o.id}`);
                        }}
                      >
                        Open quote
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={startQuoteChat.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          startQuoteChat.mutate(o);
                        }}
                      >
                        <i className="ti ti-message" /> Start Chat
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={rejectMut.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          rejectMut.mutate(o.id);
                        }}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={
                          approveMut.isPending || (lines.length > 0 && keep.length === 0)
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          approveMut.mutate({
                            orderId: o.id,
                            keepLineIds: lines.length > 0 ? keep : undefined,
                          });
                        }}
                      >
                        <i className="ti ti-check" /> Approve and start{' '}
                        {money(payTotal, quote?.currency)}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={data?.total ?? quotes.length}
        onPage={setPage}
      />

      <QuoteBuilderModal
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        onSubmitted={(id) => navigate(`/portal/quotes/${id}`)}
      />
    </div>
  );
}
