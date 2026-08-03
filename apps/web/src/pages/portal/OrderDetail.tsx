import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptQuotation,
  counterQuotation,
  getMyOrder,
  myAttachmentUrl,
  myDeliveryFileUrl,
  rejectQuotation,
  uploadAttachments,
} from '@/lib/orders';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { money, lifecycleChip, dateShort } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import { createMyConversation, listMyConversations } from '@/lib/messaging';
import type { Design, QuotationLine } from '@/lib/designs';
import type { Order, Quotation } from '@/lib/types';

type QuoteWithLines = Quotation & { lines?: QuotationLine[] };

type PortalOrderFull = Omit<Order, 'quotations'> & {
  designs?: Design[];
  quotations?: QuoteWithLines[];
};

const DESIGN_STATUS_CHIP: Record<string, string> = {
  WAITING: 'chip c-wait',
  IN_PROGRESS: 'chip c-prog',
  DONE: 'chip c-done',
  DELIVERED: 'chip c-done',
};

export function PortalOrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [counter, setCounter] = useState('');
  const [keepLineIds, setKeepLineIds] = useState<string[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-order', id],
    queryFn: () => getMyOrder(id),
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
    qc.invalidateQueries({ queryKey: ['my-order', id] });
    qc.invalidateQueries({ queryKey: ['my-orders'] });
  };

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
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: () => rejectQuotation(id),
    onSuccess: invalidate,
  });
  const counterM = useMutation({
    mutationFn: () =>
      counterQuotation(id, {
        amountCents: Math.round(parseFloat(counter || '0') * 100),
      }),
    onSuccess: () => {
      setCounter('');
      invalidate();
    },
  });

  if (isLoading) return <div className="empty">Loading…</div>;
  const order = data?.order as PortalOrderFull | undefined;
  if (!order) return <div className="empty">Order not found.</div>;

  const latestQuote = order.quotations?.[0];
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

  return (
    <div>
      <div className="ph">
        <div>
          <Link to="/portal/orders" className="form-back" style={{ marginBottom: 8 }}>
            <i className="ti ti-arrow-left" /> Back to orders
          </Link>
          <h1>
            {order.name ?? 'Order'}{' '}
            <span style={{ color: 'var(--faint)', fontWeight: 500 }}>
              #{order.humanRef ?? order.id.slice(0, 6)}
            </span>
          </h1>
          <div className="sub">
            {order.serviceType} · placed {dateShort(order.createdAt)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={startChat.isPending}
            onClick={() => startChat.mutate()}
          >
            <i className="ti ti-message" /> Start Chat
          </button>
          {(() => {
            const chip = lifecycleChip(order.status, 'customer', {
              partiallyAccepted: order.partiallyAccepted,
            });
            return <span className={chip.cls}>{chip.label}</span>;
          })()}
        </div>
      </div>

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
              <div style={{ padding: '14px 18px' }}>
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
                      return (
                        <div key={l.id} className="line">
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
                          {l.note && (
                            <span className="chip c-prog" style={{ opacity: 0.6 }}>
                              {l.note}
                            </span>
                          )}
                          <span
                            className="lp"
                            style={{ opacity: canDecide && !checked ? 0.4 : 1 }}
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
                          ? ` — ${money(selectedTotal, latestQuote.currency)}`
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

          {order.deliveries && order.deliveries.length > 0 && (
            <div className="card">
              <div className="card-h">
                <span className="ct">Delivered files</span>
              </div>
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
                        <i className="ti ti-download" />
                      </button>
                    </div>
                  )),
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {order.designs && order.designs.length > 0 && (
            <div className="card">
              <div className="card-h">
                <span className="ct">Designs</span>
              </div>
              {order.designs.map((d) => (
                <div key={d.id} className="orow" style={{ cursor: 'default' }}>
                  <div className={`thumb${serviceThumbClass(order.serviceType) ? ' m' : ''}`}>
                    <i className={`ti ${serviceTi(order.serviceType)}`} />
                  </div>
                  <div className="oinfo">
                    <div className="on">{d.name}</div>
                    <div className="om">
                      {d.placement && <span>{d.placement}</span>}
                      {d.size && <span>{d.size}</span>}
                    </div>
                  </div>
                  <span className={DESIGN_STATUS_CHIP[d.status] ?? 'chip c-prog'}>
                    {d.status.replace(/_/g, ' ')}
                  </span>
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
              <span className="v">{order.serviceType ?? '—'}</span>
            </div>
            <div className="od-line">
              <span className="l">Size</span>
              <span className="v">{order.size ?? '—'}</span>
            </div>
            <div className="od-line">
              <span className="l">Price</span>
              <span className="v">{money(order.priceCents)}</span>
            </div>
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
