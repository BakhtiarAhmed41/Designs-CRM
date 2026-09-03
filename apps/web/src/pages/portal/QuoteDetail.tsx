import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptQuotation,
  counterQuotation,
  getMyOrder,
  myAttachmentUrl,
  rejectQuotation,
} from '@/lib/orders';
import { openLinkedChat } from '@/lib/messaging';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { dateShort, money, quoteLifecycleChip } from '@/lib/format';
import { isAdminRecounter, isStaffCreatedOrder, latestCounter, lineTotal, studioQuotation } from '@/lib/quoteHelpers';
import type { Order } from '@/lib/types';
import { applyOrderChange } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuoteHistory } from '@/components/QuoteHistory';

export function PortalQuoteDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [kept, setKept] = useState<string[] | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [counterNote, setCounterNote] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-order', id],
    queryFn: () => getMyOrder(id),
    enabled: !!id,
    ...freshOnOpen,
  });

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const order = data?.order as Order | undefined;
  const studio = studioQuotation(order?.quotations);
  const counterQuote = latestCounter(order?.quotations);
  const lines = studio?.lines ?? [];

  const selected = useMemo(() => {
    if (kept) return kept;
    return lines.map((l) => l.id);
  }, [kept, lines]);

  const total = lines
    .filter((l) => selected.includes(l.id))
    .reduce((sum, l) => sum + lineTotal(l), 0);

  const acceptMut = useMutation({
    mutationFn: () => acceptQuotation(id, selected),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      setToast(
        selected.length < lines.length && lines.length > 0
          ? 'Partially accepted. Opening your order…'
          : 'Quote accepted. Opening your order…',
      );
      window.setTimeout(() => navigate(`/portal/orders/${id}`), 700);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const rejectMut = useMutation({
    mutationFn: () => rejectQuotation(id),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      setToast('Quote declined.');
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
    onSuccess: (res) => {
      setError(null);
      void applyOrderChange(qc, res.order);
      setToast('Counter sent. We’ll review it.');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const startChat = useMutation({
    mutationFn: () =>
      openLinkedChat({
        orderId: id,
        chatType: 'QUOTE',
        subject: order?.humanRef
          ? `Quotation ${order.humanRef} Chat`
          : 'Quotation Chat',
      }),
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (e) => setError(getErrorMessage(e)),
  });

  if (isLoading) {
    return <EmptyState icon="ti-loader" title="Loading quote…" />;
  }
  if (isError) {
    return (
      <EmptyState
        icon="ti-alert-circle"
        title="Could not load this quote"
        description="Check your connection and try again."
        action={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
            Try again
          </button>
        }
      />
    );
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
  const counterPending = order.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL';
  const adminRecounter = isAdminRecounter(order.quotations);
  const canPickLines = canDecide && !adminRecounter;
  const declinedByStudio = order.status === 'REJECTED';
  const offerTotal = adminRecounter ? studio?.amountCents ?? total : canDecide ? total : studio?.amountCents ?? total;
  const statusChip = quoteLifecycleChip(order.status, 'customer', {
    partiallyAccepted: order.partiallyAccepted,
    adminRecounter,
  });

  return (
    <div>
      <PageHeader
        title={order.name ?? 'Quote request'}
        subtitle={`Q-${order.humanRef ?? order.id.slice(0, 6)} · ${dateShort(order.createdAt)}${isStaffCreatedOrder(order) ? ' · Created by the studio' : ''}`}
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
              <i className="ti ti-message" /> Start Chat
            </button>
          </div>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {toast && (
        <div className="note" style={{ marginBottom: 12 }}>
          <i className="ti ti-circle-check" /> {toast}
        </div>
      )}

      {canDecide && adminRecounter && (
        <div className="quote-counter" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="quote-counter-head">
            <i className="ti ti-scale" aria-hidden />
            <div>
              <strong>Re-counter from admin</strong>
              <p>The studio sent a new price. You can accept it or counter again.</p>
            </div>
          </div>
          <div className="quote-counter-field">
            <span>Studio offered</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>
              {studio?.amountCents != null ? money(studio.amountCents, studio.currency) : '—'}
            </div>
          </div>
          {studio?.comment && (
            <div className="quote-counter-field" style={{ marginTop: 12 }}>
              <span>Their note</span>
              <div style={{ fontSize: 13.5, color: 'var(--ink)', fontStyle: 'italic' }}>
                “{studio.comment}”
              </div>
            </div>
          )}
        </div>
      )}

      {declinedByStudio && (
        <div className="note amber" style={{ marginBottom: 12 }}>
          <i className="ti ti-x" /> This quote was declined by the studio
          {order.rejectionReason ? `: ${order.rejectionReason}` : '.'}
        </div>
      )}

      {counterPending && (
        <div className="quote-counter" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="quote-counter-head">
            <i className="ti ti-scale" aria-hidden />
            <div>
              <strong>Your counter-offer</strong>
              <p>The studio is reviewing this. You don’t need to approve it.</p>
            </div>
          </div>
          {counterQuote ? (
            <>
              <div className="quote-counter-field">
                <span>You offered</span>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>
                  {counterQuote.amountCents != null
                    ? money(counterQuote.amountCents, counterQuote.currency)
                    : '—'}
                </div>
              </div>
              {counterQuote.comment && (
                <div className="quote-counter-field" style={{ marginTop: 12 }}>
                  <span>Your note</span>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', fontStyle: 'italic' }}>
                    “{counterQuote.comment}”
                  </div>
                </div>
              )}
              {studio?.amountCents != null && (
                <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                  Studio quote was {money(studio.amountCents, studio.currency)}
                </div>
              )}
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Your counter is with the studio.
            </p>
          )}
        </div>
      )}

      <div className="card card-pad">
        {lines.length === 0 && !canDecide && (
          <div className="muted">
            {order.status === 'WAITING_FOR_QUOTATION' || order.status === 'CREATED'
              ? 'Your request is being priced. You’ll see line items here when a quote is ready.'
              : order.status === 'REJECTED'
                ? 'This request was declined by the studio.'
                : 'No quotation lines yet.'}
          </div>
        )}
        {lines.length > 0 && (
          <>
            {lines.map((l) => {
              const on = selected.includes(l.id);
              return (
                <label
                  key={l.id}
                  className="quote-line"
                  style={{ cursor: canPickLines ? 'pointer' : 'default' }}
                >
                  {canPickLines && (
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
          </>
        )}
        {(canDecide || lines.length > 0) && (
          <>
            <div className="quote-total">
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {canPickLines ? 'Selected total' : 'Quoted total'}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {money(offerTotal)}
                </div>
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
                    disabled={acceptMut.isPending || (canPickLines && selected.length === 0)}
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
                    <strong>{adminRecounter ? 'Counter again' : 'Counter this quote'}</strong>
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

      <QuoteHistory quotations={order.quotations} />
    </div>
  );
}
