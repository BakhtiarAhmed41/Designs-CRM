import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptQuotation,
  getMyOrder,
  myAttachmentUrl,
} from '@/lib/orders';
import { confirmMyOrder, goToOrderCheckout } from '@/lib/billing';
import { openLinkedChat } from '@/lib/messaging';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { dateShort, money, quoteLifecycleChip, orderNumber, orderSlug } from '@/lib/format';
import { useCanonicalOrderUrl } from '@/lib/useCanonicalOrderUrl';
import { isCuttingRequest, isEmbroideryRequest, isVectorRequest } from '@/lib/embroideryQuote';
import { isAdminRecounter, isStaffCreatedOrder, latestCounter, lineTotal, studioQuotation } from '@/lib/quoteHelpers';
import type { Order } from '@/lib/types';
import { applyOrderChange } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuoteHistory } from '@/components/QuoteHistory';
import { EmbroideryCustomerQuote } from '@/components/EmbroideryCustomerQuote';
import { FormPreferencesDisplay } from '@/components/FormPreferencesDisplay';
import { QuoteJourney, QuotePricingEmpty } from '@/components/QuoteJourney';
import { quoteJourneyPhase } from '@/lib/quoteJourney';

export function PortalQuoteDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const paidReturn = searchParams.get('paid') === '1';
  const paySyncStarted = useRef(0);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [kept, setKept] = useState<string[] | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-order', id],
    queryFn: () => getMyOrder(id),
    enabled: !!id,
    ...freshOnOpen,
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) => {
      if (!paidReturn) return false;
      const current = q.state.data?.order as { paymentStatus?: string } | undefined;
      if (current?.paymentStatus === 'PAID') return false;
      if (!paySyncStarted.current) paySyncStarted.current = Date.now();
      if (Date.now() - paySyncStarted.current > 20_000) return false;
      return 1500;
    },
  });

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (searchParams.get('canceled') !== '1') return;
    setError("Payment was not completed. You can pay when you're ready.");
    const next = new URLSearchParams(searchParams);
    next.delete('canceled');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const order = data?.order as Order | undefined;
  useCanonicalOrderUrl('portal', 'quotes', id, order?.humanRef);

  useEffect(() => {
    if (!paidReturn || !order?.id) return;
    let cancelled = false;
    void confirmMyOrder(order.id).finally(() => {
      if (!cancelled) void refetch();
    });
    return () => {
      cancelled = true;
    };
  }, [paidReturn, order?.id, refetch]);

  useEffect(() => {
    if (!paidReturn || order?.paymentStatus !== 'PAID') return;
    const next = new URLSearchParams(searchParams);
    if (!next.has('paid')) return;
    next.delete('paid');
    setSearchParams(next, { replace: true });
  }, [paidReturn, order?.paymentStatus, searchParams, setSearchParams]);
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

  function goToPayment(next: { id: string; humanRef?: string | null }) {
    setPayBusy(true);
    setError(null);
    goToOrderCheckout(next.id, `/portal/quotes/${orderSlug(next.humanRef, next.id)}`);
  }

  const acceptMut = useMutation({
    mutationFn: () => acceptQuotation(id, selected),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      const next = res.order;
      if (next.status === 'PENDING_PAYMENT') {
        setToast('Quote accepted. Continue to payment…');
        void goToPayment(next);
        return;
      }
      setToast('Quote accepted.');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const startChat = useMutation({
    mutationFn: () =>
      openLinkedChat({
        orderId: id,
        chatType: 'QUOTE',
        subject: order?.humanRef
          ? `Quotation ${orderNumber(order.humanRef)} Chat`
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

  const phase = quoteJourneyPhase(order);
  const serviceQuote = isEmbroideryRequest(order) || isCuttingRequest(order) || isVectorRequest(order);
  if (serviceQuote) {
    const kind = isCuttingRequest(order) ? 'cutting' : isVectorRequest(order) ? 'vector' : 'embroidery';
    return <EmbroideryCustomerQuote order={order} kind={kind} notice={error} />;
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
    needsCustomerInfo: order.needsCustomerInfo,
    createdAt: order.createdAt,
    type: order.type,
  });
  const headerChip =
    phase === 'paid'
      ? { cls: 'qj-chip ok', label: 'Paid' }
      : phase === 'accepted'
        ? { cls: 'qj-chip ok', label: 'Confirmed' }
        : phase === 'pay'
          ? { cls: 'qj-chip review', label: 'Awaiting payment' }
          : phase === 'review' && !counterPending
            ? { cls: 'qj-chip review', label: adminRecounter ? 'Updated quote' : 'Ready for review' }
            : statusChip;
  const journeyCopy =
    order.needsCustomerInfo && phase === 'preparing'
      ? {
          title: "We're preparing your quote",
          subtitle: 'We need a few more details from you before we can finish the price.',
        }
      : counterPending
        ? {
            title: "We're reviewing your counter",
            subtitle: "We'll send an updated quote once we've looked at your offer.",
          }
        : undefined;
  const orderPath = `/portal/orders/${orderSlug(order.humanRef, order.id)}`;

  return (
    <div className="qd-page">
      <PageHeader
        title={order.name ?? 'Quote request'}
        subtitle={`${orderNumber(order.humanRef, order.id.slice(0, 6))} · ${dateShort(order.createdAt)}${isStaffCreatedOrder(order) ? ' · Created by the team' : ''}`}
        crumbs={[
          { label: 'Quotes', to: '/portal/quotes' },
          { label: orderNumber(order.humanRef, 'Quote') },
        ]}
        actions={
          <div className="qd-hero-actions">
            <span className={headerChip.cls}>{headerChip.label}</span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={startChat.isPending}
              onClick={() => startChat.mutate()}
            >
              <i className="ti ti-message" /> Need help?
            </button>
          </div>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {toast && (
        <div className="alert-success" style={{ marginBottom: 12 }}>
          <i className="ti ti-circle-check" /> {toast}
        </div>
      )}

      {phase !== 'closed' && (
        <QuoteJourney
          phase={phase}
          orderTo={orderPath}
          canChoose={canPickLines}
          paying={payBusy}
          onPay={phase === 'pay' ? () => void goToPayment(order) : undefined}
          title={journeyCopy?.title}
          subtitle={journeyCopy?.subtitle}
        />
      )}

      {canDecide && adminRecounter && (
        <div className="quote-counter" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="quote-counter-head">
            <i className="ti ti-scale" aria-hidden />
            <div>
              <strong>Updated quote</strong>
              <p>The team sent a new price.</p>
            </div>
          </div>
          <div className="quote-counter-field">
            <span>Quoted total</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>
              {studio?.amountCents != null ? money(studio.amountCents, studio.currency) : '-'}
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

      {declinedByStudio && lines.length > 0 && (
        <div className="note amber" style={{ marginBottom: 12 }}>
          <i className="ti ti-x" /> This quote was declined by the team
          {order.rejectionReason ? `: ${order.rejectionReason}` : '.'}
        </div>
      )}

      {counterPending && (
        <div className="quote-counter" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="quote-counter-head">
            <i className="ti ti-scale" aria-hidden />
            <div>
              <strong>Your counter-offer</strong>
              <p>The team is reviewing this. You don’t need to approve it.</p>
            </div>
          </div>
          {counterQuote ? (
            <>
              <div className="quote-counter-field">
                <span>You offered</span>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>
                  {counterQuote.amountCents != null
                    ? money(counterQuote.amountCents, counterQuote.currency)
                    : '-'}
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
                  Previous quote was {money(studio.amountCents, studio.currency)}
                </div>
              )}
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Your counter is with the team.
            </p>
          )}
        </div>
      )}

      <div className="card card-pad qd-offer qj-price-card">
        <h2 className="qj-price-title">Quote pricing</h2>
        {lines.length === 0 && (
          <QuotePricingEmpty
            declined={declinedByStudio || order.status === 'CLIENT_REJECTED_QUOTATION' || order.status === 'CANCELLED'}
            settled={phase !== 'preparing' && phase !== 'closed'}
            reason={order.rejectionReason}
          />
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
                            { stayOnPage: true },
                          ).catch((err) => setError(getErrorMessage(err)));
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
              {(canDecide ||
                (phase !== 'paid' &&
                  phase !== 'closed' &&
                  (phase === 'pay' || order.status === 'PENDING_PAYMENT' || order.paymentStatus === 'AWAITING'))) && (
                <div className="quote-total-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={startChat.isPending}
                    onClick={() => startChat.mutate()}
                  >
                    <i className="ti ti-message" />{' '}
                    {startChat.isPending ? 'Opening…' : 'Need help?'}
                  </button>
                  {canDecide ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={acceptMut.isPending || (canPickLines && selected.length === 0)}
                      onClick={() => acceptMut.mutate()}
                    >
                      {acceptMut.isPending || payBusy ? 'Please wait…' : 'Accept & Pay'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={payBusy}
                      onClick={() => void goToPayment(order)}
                    >
                      {payBusy ? 'Opening checkout…' : 'Pay now'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <FormPreferencesDisplay
        preferences={order.preferences}
        title="Your request"
        wide
        safe
        attachments={(order.attachments ?? []).map((a) => ({
          name: a.originalName,
          mimeType: a.mimeType,
          previewUrl: a.previewUrl,
          signedUrlPath: myAttachmentUrl(order.id, a.id),
        }))}
      />

      <QuoteHistory quotations={order.quotations} />
    </div>
  );
}
