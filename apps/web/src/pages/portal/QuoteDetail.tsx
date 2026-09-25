import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptQuotation,
  getMyOrder,
  myAttachmentUrl,
} from '@/lib/orders';
import { startMyOrderCheckout } from '@/lib/billing';
import { openLinkedChat } from '@/lib/messaging';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { dateShort, money, quoteLifecycleChip, orderNumber, orderSlug } from '@/lib/format';
import { useCanonicalOrderUrl } from '@/lib/useCanonicalOrderUrl';
import { isCuttingRequest, isEmbroideryRequest, isVectorRequest, serviceOrderKind } from '@/lib/embroideryQuote';
import { ServiceCustomerOrder } from '@/components/ServiceCustomerOrder';
import { isAdminRecounter, isStaffCreatedOrder, latestCounter, lineTotal, studioQuotation } from '@/lib/quoteHelpers';
import type { Order } from '@/lib/types';
import { applyOrderChange } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { QuoteHistory } from '@/components/QuoteHistory';
import { EmbroideryCustomerQuote } from '@/components/EmbroideryCustomerQuote';
import { FormPreferencesDisplay } from '@/components/FormPreferencesDisplay';

export function PortalQuoteDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
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
  });

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const order = data?.order as Order | undefined;
  useCanonicalOrderUrl('portal', 'quotes', id, order?.humanRef);
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

  async function goToPayment(orderId: string) {
    setPayBusy(true);
    setError(null);
    try {
      const res = await startMyOrderCheckout(orderId);
      if (res?.alreadyPaid) {
        setToast('Payment successful. Your order has been created.');
        window.setTimeout(() => navigate(`/portal/orders/${orderSlug(order?.humanRef, orderId)}`), 700);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPayBusy(false);
    }
  }

  const acceptMut = useMutation({
    mutationFn: () => acceptQuotation(id, selected),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      const next = res.order;
      if (next.status === 'PENDING_PAYMENT') {
        setToast('Quote accepted. Continue to payment…');
        void goToPayment(next.id);
        return;
      }
      setToast(
        selected.length < lines.length && lines.length > 0
          ? 'Partially accepted. Opening your order…'
          : 'Quote accepted. Opening your order…',
      );
      window.setTimeout(() => navigate(`/portal/orders/${orderSlug(next.humanRef, next.id)}`), 700);
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

  if (order.type === 'ORDER' && order.status === 'PENDING_PAYMENT') {
    return (
      <div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <EmptyState
          icon="ti-credit-card"
          title="Complete payment"
          description="Your quote is accepted. Pay to create the order."
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={payBusy}
                onClick={() => void goToPayment(order.id)}
              >
                <i className="ti ti-credit-card" /> {payBusy ? 'Opening checkout…' : 'Accept & Pay'}
              </button>
              <Link to="/portal/quotes" className="btn btn-ghost">
                Back to quotes
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  if (order.type === 'ORDER' && serviceOrderKind(order)) {
    return <ServiceCustomerOrder order={order} />;
  }

  if (order.type === 'ORDER') {
    return (
      <EmptyState
        icon="ti-circle-check"
        title="This quote is now an order"
        description="You accepted the price. Track production from the order workspace."
        action={
          <Link to={`/portal/orders/${orderSlug(order.humanRef, order.id)}`} className="btn btn-primary">
            Open order
          </Link>
        }
      />
    );
  }

  if (isEmbroideryRequest(order)) {
    return <EmbroideryCustomerQuote order={order} />;
  }

  if (isCuttingRequest(order)) {
    return <EmbroideryCustomerQuote order={order} kind="cutting" />;
  }

  if (isVectorRequest(order)) {
    return <EmbroideryCustomerQuote order={order} kind="vector" />;
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
        <div className="alert-success" style={{ marginBottom: 12 }}>
          <i className="ti ti-circle-check" /> {toast}
        </div>
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

      {declinedByStudio && (
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

      {lines.length === 0 && !canDecide && (
        <div className={`qd-wait${order.status === 'REJECTED' ? ' is-declined' : ''}`}>
          <div className="qd-wait-icon" aria-hidden>
            <i className={`ti ${order.status === 'REJECTED' ? 'ti-alert-circle' : 'ti-clock'}`} />
          </div>
          <div className="qd-wait-copy">
            <strong>
              {order.status === 'WAITING_FOR_QUOTATION' || order.status === 'CREATED'
                ? 'Your quote is being prepared'
                : order.status === 'REJECTED'
                  ? 'This request was declined'
                  : 'Pricing is not ready yet'}
            </strong>
            <p>
              {order.status === 'WAITING_FOR_QUOTATION' || order.status === 'CREATED'
                ? 'The team is reviewing your files and details. The price will show here when it is ready.'
                : order.status === 'REJECTED'
                  ? 'The team declined this request. Start a chat if you need help with a new one.'
                  : 'Pricing will show here when the quote is ready.'}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={startChat.isPending}
              onClick={() => startChat.mutate()}
            >
              <i className="ti ti-message" /> {startChat.isPending ? 'Opening…' : 'Ask a question'}
            </button>
          </div>
        </div>
      )}

      {(lines.length > 0 || canDecide) && (
      <div className="card card-pad qd-offer">
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
              {canDecide && (
                <div className="quote-total-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={startChat.isPending}
                    onClick={() => startChat.mutate()}
                  >
                    <i className="ti ti-message" />{' '}
                    {startChat.isPending ? 'Opening…' : 'Contact us'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={acceptMut.isPending || (canPickLines && selected.length === 0)}
                    onClick={() => acceptMut.mutate()}
                  >
                    {acceptMut.isPending || payBusy ? 'Please wait…' : 'Accept & Pay'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      )}

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
