import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmMyOrder, startMyOrderCheckout } from '@/lib/billing';
import {
  acceptQuotation,
  counterQuotation,
  getMyOrder,
  myAttachmentUrl,
  myDeliveryFileUrl,
  rejectQuotation,
  uploadAttachments,
} from '@/lib/orders';
import { listMyEdits, requestEdit } from '@/lib/edits';
import { RevisionRequestForm } from '@/components/RevisionRequestForm';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { money, lifecycleChip, dateShort, paymentChip } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import { createMyConversation, listMyConversations } from '@/lib/messaging';
import {
  designStatusChipClass,
  designStatusLabel,
  type Design,
  type QuotationLine,
} from '@/lib/designs';
import type { Order, Quotation } from '@/lib/types';
import { studioQuotation } from '@/lib/quoteHelpers';
import { QuoteHistory } from '@/components/QuoteHistory';
import { applyOrderChange, invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

type QuoteWithLines = Quotation & { lines?: QuotationLine[] };

type PortalOrderFull = Omit<Order, 'quotations'> & {
  designs?: Design[];
  quotations?: QuoteWithLines[];
};

export function PortalOrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const paidReturn = searchParams.get('paid') === '1';
  const [counter, setCounter] = useState('');
  const [keepLineIds, setKeepLineIds] = useState<string[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revOpen, setRevOpen] = useState(false);
  const [revNote, setRevNote] = useState('');
  const [revDesignIds, setRevDesignIds] = useState<string[]>([]);
  const [payBusy, setPayBusy] = useState(false);
  const paySyncStarted = useRef<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-order', id],
    queryFn: () => getMyOrder(id),
    ...freshOnOpen,
    refetchInterval: (q) => {
      if (!paidReturn) return false;
      const o = q.state.data?.order as { status?: string; paymentStatus?: string } | undefined;
      if (o?.paymentStatus === 'PAID' || (o && o.status !== 'PENDING_PAYMENT')) return false;
      if (!paySyncStarted.current) paySyncStarted.current = Date.now();
      if (Date.now() - paySyncStarted.current > 20_000) return false;
      return 1500;
    },
  });

  const editsQ = useQuery({
    queryKey: ['my-order-edits', id],
    queryFn: () => listMyEdits(id),
    enabled: !!id,
    ...freshOnOpen,
  });

  const revMut = useMutation({
    mutationFn: (designIds: string[]) => requestEdit(id, revNote.trim(), designIds),
    onSuccess: (res) => {
      setRevOpen(false);
      setRevNote('');
      setRevDesignIds([]);
      setActionError(null);
      applyOrderChange(qc, { ...data?.order, status: 'REVISION_REQUESTED' } as Order);
      void invalidateWorkCaches(qc);
      void qc.invalidateQueries({ queryKey: ['my-order-edits', id] });
      void qc.invalidateQueries({ queryKey: ['my-order', id] });
      return res;
    },
    onError: (e) => setActionError(getErrorMessage(e)),
  });

  const startChat = useMutation({
    mutationFn: async () => {
      const listed = await listMyConversations();
      const existing = listed.conversations.find(
        (c) => c.orderId === id && (c.chatType === 'ORDER' || c.chatType === 'QUOTE'),
      );
      if (existing) return existing;
      const orderType = data?.order?.type;
      const created = await createMyConversation({
        orderId: id,
        chatType: orderType === 'QUOTE_REQUEST' ? 'QUOTE' : 'ORDER',
        subject:
          orderType === 'QUOTE_REQUEST'
            ? `Quotation ${data?.order?.humanRef ?? ''} Chat`.trim()
            : `Order ${data?.order?.humanRef ?? ''} Chat`.trim(),
      });
      return created.conversation;
    },
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (e) => setUploadError(getErrorMessage(e)),
  });

  const invalidate = () => {
    void invalidateWorkCaches(qc);
  };

  useEffect(() => {
    if (!id || !paidReturn) return;
    if (data?.order?.paymentStatus === 'PAID') return;
    let cancelled = false;
    const askStripe = () => {
      void confirmMyOrder(id)
        .catch(() => null)
        .then(() => {
          if (cancelled) return;
          void invalidateWorkCaches(qc);
          void qc.invalidateQueries({ queryKey: ['my-order', id] });
        });
    };
    askStripe();
    const tick = window.setInterval(askStripe, 2000);
    const stop = window.setTimeout(() => window.clearInterval(tick), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [id, paidReturn, data?.order?.paymentStatus, qc]);

  useEffect(() => {
    if (!paidReturn) return;
    const o = data?.order;
    if (!o) return;
    if (o.paymentStatus === 'PAID') {
      searchParams.delete('paid');
      setSearchParams(searchParams, { replace: true });
    }
  }, [paidReturn, data?.order, searchParams, setSearchParams]);

  async function handlePay(orderId: string) {
    setPayBusy(true);
    setActionError(null);
    try {
      const res = await startMyOrderCheckout(orderId);
      if (res?.alreadyPaid) {
        await confirmMyOrder(orderId).catch(() => null);
        await invalidateWorkCaches(qc);
        await qc.invalidateQueries({ queryKey: ['my-order', orderId] });
      }
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setPayBusy(false);
    }
  }

  const uploadRefs = useMutation({
    mutationFn: (files: File[]) => uploadAttachments(id, files),
    onSuccess: () => {
      setUploadError(null);
      invalidate();
    },
    onError: (e) => setUploadError(getErrorMessage(e)),
  });

  const accept = useMutation({
    mutationFn: (ids?: string[]) => acceptQuotation(id, ids),
    onSuccess: (res) => {
      setActionError(null);
      void applyOrderChange(qc, res.order);
    },
    onError: (e) => setActionError(getErrorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: () => rejectQuotation(id),
    onSuccess: (res) => {
      setActionError(null);
      void applyOrderChange(qc, res.order);
    },
    onError: (e) => setActionError(getErrorMessage(e)),
  });
  const counterM = useMutation({
    mutationFn: () =>
      counterQuotation(id, {
        amountCents: Math.round(parseFloat(counter || '0') * 100),
      }),
    onSuccess: (res) => {
      setActionError(null);
      setCounter('');
      void applyOrderChange(qc, res.order);
    },
    onError: (e) => setActionError(getErrorMessage(e)),
  });

  if (isLoading) return <EmptyState icon="ti-loader" title="Loading order…" />;
  const order = data?.order as PortalOrderFull | undefined;
  if (!order) {
    return (
      <EmptyState
        icon="ti-package-off"
        title="Order not found"
        action={<Link to="/portal/orders" className="btn btn-ghost btn-sm">Back to orders</Link>}
      />
    );
  }

  const latestQuote = studioQuotation(order.quotations) ?? order.quotations?.[0];
  const canDecide = order.status === 'QUOTATION_PROVIDED';
  const canUploadRefs =
    order.status === 'WAITING_FOR_QUOTATION' ||
    order.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL' ||
    order.status === 'QUOTATION_PROVIDED';
  const lines = latestQuote?.lines ?? [];
  const selected =
    keepLineIds ?? lines.map((l) => l.id);
  const selectedTotal = lines
    .filter((l) => selected.includes(l.id))
    .reduce(
      (sum, l) =>
        sum +
        (l.priceCents ?? 0) +
        l.sizes.reduce((s, sz) => s + (sz.priceCents ?? 0), 0),
      0,
    );
  const openRevision = (editsQ.data?.edits ?? []).find((e) => e.status === 'PENDING');
  const revisionIds = openRevision?.designIds ?? [];
  const canRequestRevision =
    order.status === 'COMPLETED' ||
    order.status === 'CLOSED' ||
    order.status === 'REVISION_REQUESTED' ||
    (order.designs ?? []).some((d) => d.status === 'DELIVERED');
  const payChip = paymentChip(order.paymentStatus);

  return (
    <div>
      <PageHeader
        title={order.name ?? 'Order'}
        subtitle={`${order.serviceType ?? 'Order'} · #${order.humanRef ?? order.id.slice(0, 6)} · ${dateShort(order.createdAt)}`}
        crumbs={[
          { label: 'Orders', to: '/portal/orders' },
          { label: order.humanRef ?? 'Order' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {order.status === 'PENDING_PAYMENT' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={payBusy}
              onClick={() => {
                void handlePay(order.id);
              }}
            >
              <i className="ti ti-credit-card" /> {payBusy ? 'Opening checkout…' : 'Pay with card'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={startChat.isPending}
            onClick={() => startChat.mutate()}
          >
            <i className="ti ti-message" /> Message team
          </button>
          {canRequestRevision && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRevOpen((v) => !v)}
            >
              <i className="ti ti-edit" /> Request revision
            </button>
          )}
          {(() => {
            const chip = lifecycleChip(order.status, 'customer', {
              partiallyAccepted: order.partiallyAccepted,
              partiallyDelivered: order.partiallyDelivered,
            });
            return <span className={chip.cls}>{chip.label}</span>;
          })()}
          </div>
        }
      />

      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}
      {paidReturn && order.paymentStatus !== 'PAID' && (
        <div className="note" style={{ marginBottom: 14 }}>
          <i className="ti ti-loader" /> Confirming payment with Stripe…
        </div>
      )}

      {openRevision && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-refresh" /> Your revision
            </span>
            <span className="chip c-review">Revision requested</span>
          </div>
          <div style={{ padding: '12px 16px 16px' }}>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{openRevision.note}</div>
            {revisionIds.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--muted)' }}>
                {(order.designs ?? [])
                  .filter((d) => revisionIds.includes(d.id))
                  .map((d) => d.name)
                  .join(', ') || 'Selected designs'}
              </div>
            )}
          </div>
        </div>
      )}

      {revOpen && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px 16px' }}>
          <RevisionRequestForm
            designs={order.designs ?? []}
            note={revNote}
            onNote={setRevNote}
            selectedIds={revDesignIds}
            onToggle={(designId) =>
              setRevDesignIds((prev) =>
                prev.includes(designId) ? prev.filter((x) => x !== designId) : [...prev, designId],
              )
            }
            onCancel={() => {
              setRevOpen(false);
              setRevNote('');
              setRevDesignIds([]);
            }}
            onSubmit={(ids) => revMut.mutate(ids)}
            pending={revMut.isPending}
          />
        </div>
      )}

      <div className="od-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {latestQuote && (
            <div className="card">
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-file-invoice" style={{ marginRight: 6 }} />
                  Latest quotation (v{latestQuote.version})
                </span>
                <span className="chip c-quote">{latestQuote.status}</span>
              </div>
              <div className="card-b">
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--navy)' }}>
                  {money(latestQuote.amountCents, latestQuote.currency)}
                </div>
                {latestQuote.comment && (
                  <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
                    {latestQuote.comment}
                  </div>
                )}
                {latestQuote.lines && latestQuote.lines.length > 0 && (
                  <div className="batch" style={{ marginTop: 14, paddingLeft: 0 }}>
                    {latestQuote.lines.map((l) => {
                      const sizesTotal = l.sizes.reduce(
                        (sum, s) => sum + (s.priceCents ?? 0),
                        0,
                      );
                      const lineTotal = (l.priceCents ?? 0) + sizesTotal;
                      const checked = selected.includes(l.id);
                      const decision = l.clientDecision;
                      const decided = !canDecide && (decision === 'KEPT' || decision === 'DROPPED');
                      return (
                        <div
                          key={l.id}
                          className="line"
                          style={
                            decided
                              ? {
                                  background: 'var(--etsy-white)',
                                  borderRadius: 8,
                                  padding: '6px 8px',
                                }
                              : undefined
                          }
                        >
                          <span className="ln">
                            {canDecide ? (
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setKeepLineIds((prev) => {
                                      const base = prev ?? lines.map((x) => x.id);
                                      return base.includes(l.id)
                                        ? base.filter((x) => x !== l.id)
                                        : [...base, l.id];
                                    });
                                  }}
                                />
                                {l.name}
                              </label>
                            ) : (
                              <>
                                <i className="ti ti-point" /> {l.name}
                              </>
                            )}
                          </span>
                          {decided && (
                            <span className={decision === 'KEPT' ? 'chip c-done' : 'chip c-wait'}>
                              {decision === 'KEPT' ? 'Approved' : 'Rejected'}
                            </span>
                          )}
                          {l.note && (
                            <span className="chip c-prog" style={{ opacity: 0.6 }}>
                              {l.note}
                            </span>
                          )}
                          <span
                            className="lp"
                            style={{
                              opacity: canDecide && !checked ? 0.4 : 1,
                              color: 'var(--ink)',
                            }}
                          >
                            {money(lineTotal, latestQuote.currency)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {canDecide && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          accept.mutate(lines.length > 0 ? selected : undefined)
                        }
                        disabled={
                          accept.isPending || (lines.length > 0 && selected.length === 0)
                        }
                      >
                        <i className="ti ti-check" /> Approve &amp; start
                        {lines.length > 0
                          ? ` (${money(selectedTotal, latestQuote.currency)})`
                          : ''}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => reject.mutate()}
                        disabled={reject.isPending}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={startChat.isPending}
                        onClick={() => startChat.mutate()}
                      >
                        <i className="ti ti-message" /> Start Chat
                      </button>
                    </div>
                    <div className="pf" style={{ marginTop: 14 }}>
                      <label>Or propose your own price (counter)</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          placeholder="$"
                          value={counter}
                          onChange={(e) => setCounter(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => counterM.mutate()}
                          disabled={!counter || counterM.isPending}
                        >
                          Send counter
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <QuoteHistory quotations={order.quotations} />

          <div className="card">
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-folder" /> Your files
              </span>
            </div>
            {order.deliveries && order.deliveries.length > 0 ? (
              <div className="od-files">
                {order.deliveries.flatMap((d) =>
                  d.files.map((f) => (
                    <div key={f.id} className="odf">
                      <i className={`ti ${serviceTi(f.formatLabel)}`} />
                      <span>{f.originalName}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          downloadSignedFile(myDeliveryFileUrl(order.id, f.id), f.originalName)
                        }
                      >
                        <i className="ti ti-download" /> Download
                      </button>
                    </div>
                  )),
                )}
              </div>
            ) : (
              <div className="muted" style={{ padding: '14px 16px 16px', fontSize: 13.5 }}>
                Files show up here after our team releases them. You can also find them under Files.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {order.designs && order.designs.length > 0 && (
            <div className="card">
              <div className="card-h">
                <span className="ct">Designs</span>
              </div>
              {order.designs.map((d) => (
                <div key={d.id} className="orow orow-status-under" style={{ cursor: 'default' }}>
                  <div className={`thumb${serviceThumbClass(order.serviceType) ? ' m' : ''}`}>
                    <i className={`ti ${serviceTi(order.serviceType)}`} />
                  </div>
                  <div className="oinfo">
                    <div className="on">{d.name}</div>
                    <div className="om">
                      {d.placement && <span>{d.placement}</span>}
                      {d.size && <span>{d.size}</span>}
                    </div>
                    <div className="ostatus">
                      <span className={designStatusChipClass(d.status)}>
                        {designStatusLabel(d.status)}
                      </span>
                      {Boolean(openRevision) &&
                        (revisionIds.length === 0 || revisionIds.includes(d.id)) && (
                          <span className="chip c-review">Revision requested</span>
                        )}
                    </div>
                  </div>
                  <div className="oprice">{money(d.priceCents)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-h">
              <span className="ct">Details</span>
            </div>
            <div className="od-line">
              <span className="l">Service</span>
              <span className="v">{order.serviceType ?? 'None'}</span>
            </div>
            <div className="od-line">
              <span className="l">Size</span>
              <span className="v">{order.size ?? 'None'}</span>
            </div>
            <div className="od-line">
              <span className="l">Price</span>
              <span className="v">{money(order.priceCents)}</span>
            </div>
            <div className="od-line">
              <span className="l">Payment</span>
              <span className="v">
                <span className={payChip.cls}>{payChip.label}</span>
              </span>
            </div>
            {order.status === 'PENDING_PAYMENT' && (
              <div style={{ padding: '0 16px 14px' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={payBusy}
                  onClick={() => {
                    void handlePay(order.id);
                  }}
                >
                  <i className="ti ti-credit-card" /> {payBusy ? 'Opening checkout…' : 'Pay this order'}
                </button>
              </div>
            )}
            {order.instructions && (
              <div className="od-line">
                <span className="l">Instructions</span>
                <span className="v" style={{ maxWidth: 180, textAlign: 'right' }}>
                  {order.instructions}
                </span>
              </div>
            )}
          </div>

          {(canUploadRefs || (order.attachments && order.attachments.length > 0)) && (
            <div className="card">
              <div className="card-h">
                <span className="ct">Your references</span>
              </div>
              {(order.attachments ?? []).map((a) => (
                <div key={a.id} className="orow" style={{ cursor: 'default' }}>
                  <div className="thumb">
                    <i className="ti ti-paperclip" />
                  </div>
                  <div className="oinfo">
                    <div className="on">{a.originalName}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      downloadSignedFile(myAttachmentUrl(order.id, a.id), a.originalName)
                    }
                  >
                    <i className="ti ti-download" />
                  </button>
                </div>
              ))}
              {canUploadRefs && (
                <div style={{ padding: '10px 14px 14px' }}>
                  {uploadError && (
                    <div className="alert-error" style={{ marginBottom: 8 }}>
                      {uploadError}
                    </div>
                  )}
                  <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                    <i className="ti ti-cloud-upload" />{' '}
                    {uploadRefs.isPending ? 'Uploading…' : 'Add files'}
                    <input
                      type="file"
                      multiple
                      hidden
                      disabled={uploadRefs.isPending}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length) uploadRefs.mutate(files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
