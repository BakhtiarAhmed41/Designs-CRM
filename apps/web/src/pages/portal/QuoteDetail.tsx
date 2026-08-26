import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptQuotation,
  counterQuotation,
  getMyOrder,
  myAttachmentUrl,
  rejectQuotation,
} from '@/lib/orders';
import { createMyConversation, listMyConversations } from '@/lib/messaging';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { dateShort, money, quoteLifecycleChip } from '@/lib/format';
import type { QuotationLine } from '@/lib/designs';
import type { Order, Quotation } from '@/lib/types';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

type QuoteWithLines = Quotation & { lines?: QuotationLine[] };

function lineTotal(l: QuotationLine) {
  return (l.priceCents ?? 0) + l.sizes.reduce((s, sz) => s + (sz.priceCents ?? 0), 0);
}

export function PortalQuoteDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<string[] | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [counterNote, setCounterNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['my-order', id],
    queryFn: () => getMyOrder(id),
    enabled: !!id,
  });

  const order = data?.order as Order | undefined;
  const quotations = (order as Order & { quotations?: QuoteWithLines[] } | undefined)
    ?.quotations;
  const latest = quotations?.[0];
  const lines = latest?.lines ?? [];

  const selected = useMemo(() => {
    if (kept) return kept;
    return lines.map((l) => l.id);
  }, [kept, lines]);

  const total = lines
    .filter((l) => selected.includes(l.id))
    .reduce((sum, l) => sum + lineTotal(l), 0);

  const acceptMut = useMutation({
    mutationFn: () => acceptQuotation(id, selected),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      void qc.invalidateQueries({ queryKey: ['my-order', id] });
      void qc.invalidateQueries({ queryKey: ['admin-quotes'] });
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      navigate('/portal/orders');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const rejectMut = useMutation({
    mutationFn: () => rejectQuotation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      void qc.invalidateQueries({ queryKey: ['my-order', id] });
      void qc.invalidateQueries({ queryKey: ['admin-quotes'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const counterMut = useMutation({
    mutationFn: () =>
      counterQuotation(id, {
        amountCents: counterAmount
          ? Math.round(parseFloat(counterAmount) * 100)
          : undefined,
        comment: counterNote.trim() || undefined,
      }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['my-order', id] });
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const startChat = useMutation({
    mutationFn: async () => {
      const listed = await listMyConversations();
      const existing = listed.conversations.find(
        (c) => c.orderId === id && c.chatType === 'QUOTE',
      );
      if (existing) return existing;
      const created = await createMyConversation({
        orderId: id,
        chatType: 'QUOTE',
        subject: order?.humanRef
          ? `Quotation ${order.humanRef} Chat`
          : 'Quotation Chat',
      });
      return created.conversation;
    },
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (e) => setError(getErrorMessage(e)),
  });

  if (isLoading) {
    return <EmptyState icon="ti-loader" title="Loading quote…" />;
  }
  if (!order) {
    return (
      <EmptyState
        icon="ti-file-off"
        title="Quote not found"
        description="It may have been removed or the link is outdated."
        action={<Link to="/portal/quotes" className="btn btn-ghost btn-sm">Back to quotes</Link>}
      />
    );
  }

  if (order.type === 'ORDER') {
    return (
      <EmptyState
        icon="ti-circle-check"
        title="This quote is now an order"
        description="You accepted the price. Track production from the order workspace."
        action={
          <Link to={`/portal/orders/${order.id}`} className="btn btn-primary">
            Open order
          </Link>
        }
      />
    );
  }

  const canDecide = order.status === 'QUOTATION_PROVIDED';
  const statusChip = quoteLifecycleChip(order.status, 'customer', {
    partiallyAccepted: order.partiallyAccepted,
  });

  return (
    <div>
      <PageHeader
        title={order.name ?? 'Quote request'}
        subtitle={`Q-${order.humanRef ?? order.id.slice(0, 6)} · ${dateShort(order.createdAt)}`}
        crumbs={[
          { label: 'Quotes', to: '/portal/quotes' },
          { label: order.humanRef ?? 'Quote' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={statusChip.cls}>{statusChip.label}</span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={startChat.isPending}
              onClick={() => startChat.mutate()}
            >
              <i className="ti ti-message" /> Message team
            </button>
          </div>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="card card-pad">
        {lines.length === 0 ? (
          <div className="muted">
            {order.status === 'WAITING_FOR_QUOTATION' || order.status === 'CREATED'
              ? 'Your request is being priced. You’ll see line items here when a quote is ready.'
              : 'No quotation lines yet.'}
          </div>
        ) : (
          <>
            {lines.map((l) => {
              const on = selected.includes(l.id);
              return (
                <label
                  key={l.id}
                  className="quote-line"
                  style={{ cursor: canDecide ? 'pointer' : 'default' }}
                >
                  {canDecide && (
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        setKept((prev) => {
                          const cur = prev ?? lines.map((x) => x.id);
                          return on
                            ? cur.filter((x) => x !== l.id)
                            : [...cur, l.id];
                        });
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    {l.note && <div className="muted" style={{ fontSize: 12.5 }}>{l.note}</div>}
                    {l.attachmentId && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 6 }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void downloadSignedFile(
                            myAttachmentUrl(id, l.attachmentId!),
                            l.name,
                          );
                        }}
                      >
                        <i className="ti ti-download" /> Download file
                      </button>
                    )}
                    {l.sizes.length > 0 && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {l.sizes.map((s) => `${s.label}: ${money(s.priceCents)}`).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div style={{ fontWeight: 600 }}>{money(lineTotal(l))}</div>
                </label>
              );
            })}
            <div className="quote-total">
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Selected total</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{money(total)}</div>
              </div>
              {canDecide && (
                <div className="quote-total-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={rejectMut.isPending}
                    onClick={() => rejectMut.mutate()}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={acceptMut.isPending || selected.length === 0}
                    onClick={() => acceptMut.mutate()}
                  >
                    Accept &amp; convert to order
                  </button>
                </div>
              )}
            </div>
            {canDecide && (
              <div className="quote-counter">
                <div className="quote-counter-head">
                  <i className="ti ti-scale" aria-hidden />
                  <div>
                    <strong>Counter this quote</strong>
                    <p>Suggest a different total. We’ll review it and reply.</p>
                  </div>
                </div>
                <div className="quote-counter-grid">
                  <label className="quote-counter-field">
                    <span>Your amount</span>
                    <div className="quote-counter-amount">
                      <span aria-hidden>$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={counterAmount}
                        onChange={(e) => setCounterAmount(e.target.value)}
                      />
                    </div>
                  </label>
                  <label className="quote-counter-field">
                    <span>Note for the team</span>
                    <textarea
                      rows={2}
                      placeholder="Optional — why this price works for you"
                      value={counterNote}
                      onChange={(e) => setCounterNote(e.target.value)}
                    />
                  </label>
                </div>
                <div className="quote-counter-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={counterMut.isPending || !counterAmount}
                    onClick={() => counterMut.mutate()}
                  >
                    <i className="ti ti-send" />
                    {counterMut.isPending ? 'Sending…' : 'Send counter-offer'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
