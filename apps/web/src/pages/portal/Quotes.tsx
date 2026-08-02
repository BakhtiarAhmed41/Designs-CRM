import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { QuoteBuilderModal } from '@/components/QuoteBuilderModal';
import { acceptQuotation, listMyOrders, rejectQuotation } from '@/lib/orders';
import { createMyConversation, listMyConversations } from '@/lib/messaging';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import type { Order, Quotation } from '@/lib/types';
import type { QuotationLine } from '@/lib/designs';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';

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
    ].includes(o.status)
  );
}

function quoteChip(o: Order): { cls: string; label: string } {
  if (o.status === 'CREATED') return { cls: 'chip c-new', label: 'Draft' };
  if (o.status === 'QUOTATION_PROVIDED') return { cls: 'chip c-quote', label: 'Quote ready' };
  if (o.status === 'WAITING_FOR_QUOTATION') return { cls: 'chip c-wait', label: 'Being priced' };
  if (o.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL') {
    return { cls: 'chip c-wait', label: 'Counter pending' };
  }
  if (o.status === 'CLIENT_REJECTED_QUOTATION') return { cls: 'chip c-wait', label: 'Rejected' };
  return { cls: 'chip c-prog', label: 'In review' };
}

function lineTotal(l: QuotationLine) {
  return (l.priceCents ?? 0) + l.sizes.reduce((s, sz) => s + (sz.priceCents ?? 0), 0);
}

export function PortalQuotes() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keptByOrder, setKeptByOrder] = useState<Record<string, string[]>>({});
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['my-orders'],
    queryFn: listMyOrders,
  });

  const quotesAll = useMemo(() => {
    let list = (data?.orders ?? []).filter(isQuoteOrder);
    if (status) list = list.filter((o) => o.status === status);
    if (q.trim()) {
      const term = q.trim().toLowerCase();
      list = list.filter(
        (o) =>
          (o.name ?? '').toLowerCase().includes(term) ||
          (o.humanRef ?? '').toLowerCase().includes(term),
      );
    }
    if (dateFrom) {
      list = list.filter((o) => o.createdAt.slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((o) => o.createdAt.slice(0, 10) <= dateTo);
    }
    return list;
  }, [data?.orders, q, status, dateFrom, dateTo]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(quotesAll.length / pageSize));
  const quotes = quotesAll.slice((page - 1) * pageSize, page * pageSize);
  const awaiting = quotesAll.filter((o) => o.status === 'QUOTATION_PROVIDED').length;
  const pricing = quotesAll.filter((o) => o.status === 'WAITING_FOR_QUOTATION').length;

  const approveMut = useMutation({
    mutationFn: ({ orderId, keepLineIds }: { orderId: string; keepLineIds?: string[] }) =>
      acceptQuotation(orderId, keepLineIds),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['my-orders'] });
      qc.invalidateQueries({ queryKey: ['portal-orders-nav'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const rejectMut = useMutation({
    mutationFn: (orderId: string) => rejectQuotation(orderId),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['my-orders'] });
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
      <div className="ph">
        <div>
          <h1>Quotes</h1>
          <div className="sub">
            Requests you&apos;ve submitted. See our price, then approve to start production or
            message us to adjust.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setQuoteOpen(true)}>
          <i className="ti ti-plus" /> Request a quote
        </button>
      </div>

      {error && (
        <div className="alert-error" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="sl">Awaiting your approval</div>
          <div className="sv maroon">{awaiting}</div>
          <div className="sd">Ready to review</div>
        </div>
        <div className="stat">
          <div className="sl">Being priced by us</div>
          <div className="sv">{pricing}</div>
          <div className="sd">We&apos;ll get back within a few hours</div>
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
        {isLoading && <div className="empty">Loading…</div>}
        {!isLoading && quotes.length === 0 && (
          <div className="empty">
            <i className="ti ti-file-invoice" />
            <p>No quote requests yet.</p>
          </div>
        )}
        {quotes.map((o) => {
          const chip = quoteChip(o);
          const quote = o.quotations?.[0] as QuoteWithLines | undefined;
          const lines = quote?.lines ?? [];
          const total = quote?.amountCents ?? null;
          const open = expanded === o.id;
          const canApprove = o.status === 'QUOTATION_PROVIDED';
          const keep = keptLines(o.id, lines);
          const payTotal = lines.length > 0 ? selectedTotal(o.id, lines) : total;

          return (
            <div key={o.id}>
              <div className="orow" onClick={() => toggle(o.id)}>
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
                      {lines.length > 0 && <div className="os">tap to see breakdown</div>}
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
                        <i className="ti ti-check" /> Approve &amp; start —{' '}
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
        total={quotesAll.length}
        onPage={setPage}
      />

      <QuoteBuilderModal
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        onSubmitted={(id) => navigate(`/portal/orders/${id}`)}
      />
    </div>
  );
}
