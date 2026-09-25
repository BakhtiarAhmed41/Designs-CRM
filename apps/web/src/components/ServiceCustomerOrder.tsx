import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { useTopbarLead } from '@/components/Shell';
import { ErrorBanner } from '@/components/ui/EmptyState';
import { apiFetch, downloadSignedFile, getErrorMessage, resolveFileUrl } from '@/lib/api';
import { startMyOrderCheckout } from '@/lib/billing';
import type { Design } from '@/lib/designs';
import {
  asEmbroideryPrefs,
  backgroundLabel,
  colorModeLabel,
  designOptionLabel,
  embroideryDesigns,
  filesForDesign,
  resolutionLabel,
  serviceOrderKind,
  sizeDetail,
  turnaroundLabel,
  type EmbAttachment,
} from '@/lib/embroideryQuote';
import { dateShort, money, orderNumber } from '@/lib/format';
import { openLinkedChat } from '@/lib/messaging';
import { myAttachmentUrl, myDeliveryFileUrl } from '@/lib/orders';
import { isStaffCreatedOrder, quoteHistoryLabel, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import { deliveryCounts, orderDeliveryGroups, type DeliveryRow } from '@/lib/serviceOrderView';
import type { Order } from '@/lib/types';
import '@/styles/embroidery-quote.css';

type CustomerOrder = Order & { designs?: Design[] };

export function ServiceCustomerOrder({ order }: { order: CustomerOrder }) {
  const kind = serviceOrderKind(order) ?? 'embroidery';
  const cutting = kind === 'cutting';
  const vector = kind === 'vector';
  const navigate = useNavigate();
  const prefs = asEmbroideryPrefs(order.preferences);
  const designs = embroideryDesigns(order.preferences, order.name);
  const quotations = (order.quotations ?? []) as QuoteWithLines[];
  const studio = studioQuotation(quotations);
  const lines = studio?.lines ?? [];
  const groups = orderDeliveryGroups(order, lines);
  const counts = deliveryCounts(groups);
  const paid = order.paymentStatus === 'PAID';
  const awaiting =
    order.status === 'PENDING_PAYMENT' ||
    order.paymentStatus === 'AWAITING' ||
    order.paymentStatus === 'UNPAID';
  const quoteNo = orderNumber(order.humanRef, order.id.slice(0, 6));
  const total = order.priceCents ?? groups.flatMap((group) => group.rows).reduce((sum, row) => sum + row.priceCents, 0);
  const attachments: EmbAttachment[] = (order.attachments ?? []).map((file) => ({
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    previewUrl: file.previewUrl,
  }));
  const claimed = new Set<string>();
  const designFiles = designs.map((design) => filesForDesign(design, attachments, claimed));
  const history = [...quotations].sort((a, b) => a.version - b.version);
  const header = counts.allDelivered
    ? { text: 'Delivered', ok: true }
    : awaiting
      ? { text: 'Awaiting payment', ok: false }
      : { text: 'In process', ok: false };

  const [open, setOpen] = useState({ summary: false, request: false, delivery: false, history: false });
  const [filesFor, setFilesFor] = useState<DeliveryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const topbarLead = useMemo(
    () => (
      <nav className="ecd-crumb" aria-label="Breadcrumb">
        <Link to="/portal/quotes">Quotes</Link>
        <span aria-hidden="true">/</span>
        <b>{quoteNo}</b>
      </nav>
    ),
    [quoteNo],
  );
  useTopbarLead(topbarLead);

  const chat = useMutation({
    mutationFn: () =>
      openLinkedChat({
        orderId: order.id,
        chatType: 'ORDER',
        label: counts.allDelivered ? 'HELP' : undefined,
        subject: `Order ${quoteNo} Chat`,
      }),
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const deliveredFiles = (row: DeliveryRow) =>
    (order.deliveries ?? []).flatMap((batch) =>
      batch.files.filter((file) => file.designId && file.designId === row.design?.id),
    );

  async function pay() {
    setPayBusy(true);
    setError(null);
    try {
      const res = await startMyOrderCheckout(order.id);
      if (res?.alreadyPaid) navigate(`/portal/orders/${order.id}`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPayBusy(false);
    }
  }

  async function previewFile(fileId: string) {
    const { url } = await apiFetch<{ url: string }>(myDeliveryFileUrl(order.id, fileId));
    window.open(resolveFileUrl(url), '_blank', 'noopener');
  }

  return (
    <div className="ecd">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="ecd-head">
        <div>
          <h1>{order.name?.trim() || 'Order'}</h1>
          <div className="ecd-meta">
            <span className={header.ok ? 'ecd-tag ok' : 'ecd-tag'}>{header.text}</span>
            <span className="ecd-sep" />
            <span>Requested {dateShort(order.createdAt)}</span>
            {isStaffCreatedOrder(order) && (
              <>
                <span className="ecd-sep" />
                <span>Created by the team</span>
              </>
            )}
          </div>
        </div>
        <div className="ecd-acts">
          <button type="button" className="ecd-btn pri" disabled={chat.isPending} onClick={() => chat.mutate()}>
            <i className="ti ti-message" /> {chat.isPending ? 'Opening…' : 'Start Chat'}
          </button>
        </div>
      </div>

      <div className="ecd-sheet">
        <section className="ecd-sec">
          <div className="ecd-sec-h">
            <h2>Order delivery</h2>
          </div>
          <div className="ecd-body">
            {groups.length === 0 && <p className="ecd-wait">No items on this order yet.</p>}
            {groups.map((group) => (
              <div key={group.title} className="sod-cgroup">
                <div className="sod-cgroup-name">{group.title}</div>
                {group.rows.map((row) => {
                  const delivered = row.design?.status === 'DELIVERED';
                  return (
                    <div key={row.key} className="sod-crow">
                      <span className="sod-cname">{row.name}</span>
                      <span className={delivered ? 'sod-cstatus delivered' : 'sod-cstatus'}>
                        {delivered ? 'Delivered' : 'In progress'}
                      </span>
                      {delivered && (
                        <button
                          type="button"
                          className="sod-eye"
                          title="View delivered files"
                          onClick={() => setFilesFor(row)}
                        >
                          <i className="ti ti-eye" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <section className="ecd-sec">
          <div className={open.summary ? 'ecd-sec-h open' : 'ecd-sec-h'}>
            <h2>Order summary</h2>
            <button
              type="button"
              className="ecd-disclose"
              aria-expanded={open.summary}
              onClick={() => setOpen((prev) => ({ ...prev, summary: !prev.summary }))}
            >
              Details <i className="ti ti-chevron-down" />
            </button>
          </div>
          <div className={open.summary ? 'ecd-body' : 'ecd-body collapsed'}>
            {groups.map((group) => (
              <div key={group.title} className="sod-cgroup">
                <div className="sod-cgroup-name">{group.title}</div>
                {group.rows.map((row) => (
                  <div key={row.key} className="sod-crow">
                    <input type="checkbox" checked disabled readOnly />
                    <span className="sod-cname">{row.name}</span>
                    <span className="sod-cprice">{money(row.priceCents, order.currency)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="ecd-foot">
              <div>
                <div className="ecd-total-label">Order total</div>
                <div className="ecd-total">{money(total, order.currency)}</div>
              </div>
              <div className="ecd-foot-acts">
                {paid && (
                  <span className="ecd-tag ok">
                    <i className="ti ti-check" /> Accepted & paid
                  </span>
                )}
                {order.paymentStatus === 'REFUNDED' && <span className="ecd-tag">Refunded</span>}
                {awaiting && (
                  <button type="button" className="ecd-btn pri" disabled={payBusy} onClick={() => void pay()}>
                    <i className="ti ti-credit-card" /> {payBusy ? 'Opening checkout…' : 'Pay now'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="ecd-sec">
          <div className={open.request ? 'ecd-sec-h open' : 'ecd-sec-h'}>
            <h2>Customer request</h2>
            <button
              type="button"
              className="ecd-disclose"
              aria-expanded={open.request}
              onClick={() => setOpen((prev) => ({ ...prev, request: !prev.request }))}
            >
              Details <i className="ti ti-chevron-down" />
            </button>
          </div>
          <div className={open.request ? 'ecd-body' : 'ecd-body collapsed'}>
            {designs.map((design, index) => {
              const files = designFiles[index] ?? { artwork: [], references: [] };
              const sizes = (design.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
              const hasRefs = files.references.length > 0;
              return (
                <div key={`${design.name ?? 'design'}-${index}`} className="ecd-design">
                  <h3>
                    <span className="ecd-num">{index + 1}</span>
                    {design.name?.trim() || `Design ${index + 1}`}
                  </h3>
                  <div className={hasRefs ? 'ecd-assets' : undefined}>
                    <div>
                      <div className="ecd-label">Artwork</div>
                      <div className="ecd-swatches">
                        {files.artwork.map((file) => (
                          <EmbroideryFileCard
                            key={file.id}
                            name={file.name}
                            mimeType={file.mimeType}
                            previewUrl={file.previewUrl}
                            signedUrlPath={myAttachmentUrl(order.id, file.id)}
                            label="Main Artwork"
                            variant="swatch"
                            onError={setError}
                          />
                        ))}
                        {files.artwork.length === 0 && <div className="ecd-wait">No artwork uploaded.</div>}
                      </div>
                    </div>
                    {hasRefs && (
                      <div>
                        <div className="ecd-label">Reference images</div>
                        <div className="ecd-swatches">
                          {files.references.map((file) => (
                            <EmbroideryFileCard
                              key={file.id}
                              name={file.name}
                              mimeType={file.mimeType}
                              previewUrl={file.previewUrl}
                              signedUrlPath={myAttachmentUrl(order.id, file.id)}
                              label="Reference"
                              variant="swatch"
                              onError={setError}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {vector ? (
                    <>
                      <div className="ecd-label">Artwork preferences</div>
                      <div className="ecd-spec">
                        <dl className="ecd-pref">
                          <div>
                            <dt>Background</dt>
                            <dd>{backgroundLabel(design.background)}</dd>
                          </div>
                          <div>
                            <dt>Color Mode</dt>
                            <dd>{colorModeLabel(design.colors)}</dd>
                          </div>
                          <div>
                            <dt>Resolution</dt>
                            <dd>{resolutionLabel(design.dpi300)}</dd>
                          </div>
                        </dl>
                        {design.notes?.trim() && (
                          <>
                            <span className="ecd-note-kicker">Customer's note</span>
                            <p className="ecd-note">{design.notes.trim()}</p>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="ecd-label">Sizes and placement</div>
                      <div className="ecd-spec">
                        <table className={cutting ? 'ecd-table ecd-table-cut' : 'ecd-table'}>
                          <thead>
                            <tr>
                              <th style={{ width: cutting ? '65%' : '40%' }}>Size or Placement</th>
                              {!cutting && <th>Embroidered on</th>}
                              <th><span className="ecd-prop">Proportional</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {sizes.map((size, sizeIndex) => (
                              <tr key={`${size.detail ?? 'size'}-${sizeIndex}`}>
                                <td>{sizeDetail(size)}</td>
                                {!cutting && <td>{size.placement || '—'}</td>}
                                <td>
                                  <span className="ecd-prop">
                                    <span className="ecd-prop-sizer" aria-hidden="true">Proportional</span>
                                    {size.keepProportional === false ? (
                                      <span>No</span>
                                    ) : (
                                      <span className="ecd-yes">
                                        <i className="ti ti-check" /> Yes
                                      </span>
                                    )}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {sizes.length === 0 && (
                              <tr>
                                <td colSpan={cutting ? 2 : 3}>No sizes added.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {design.notes?.trim() && (
                          <>
                            <span className="ecd-note-kicker">Customer's note</span>
                            <p className="ecd-note">{design.notes.trim()}</p>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="ecd-sec">
          <div className={open.delivery ? 'ecd-sec-h open' : 'ecd-sec-h'}>
            <h2>Delivery preferences</h2>
            <button
              type="button"
              className="ecd-disclose"
              aria-expanded={open.delivery}
              onClick={() => setOpen((prev) => ({ ...prev, delivery: !prev.delivery }))}
            >
              Details <i className="ti ti-chevron-down" />
            </button>
          </div>
          <div className={open.delivery ? 'ecd-body' : 'ecd-body collapsed'}>
            <div className="ecd-pref">
              <div>
                <dt>Requested file formats</dt>
                {(prefs?.formats ?? []).length === 0 && <dd>None selected</dd>}
                {(prefs?.formats ?? []).length > 0 && (
                  <div className="ecd-chips">
                    {(prefs?.formats ?? []).map((fmt) => (
                      <span key={fmt} className="ecd-chip">{fmt}</span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <dt>Preview files included</dt>
                <dd>{cutting ? 'Proof preview' : 'PDF and PNG'}</dd>
              </div>
              <div>
                <dt>Turnaround requested</dt>
                <dd>{turnaroundLabel(prefs?.turnaround).replace(' · ', ', ')}</dd>
              </div>
            </div>
          </div>
        </section>

        <section className="ecd-sec">
          <div className={open.history ? 'ecd-sec-h open' : 'ecd-sec-h'}>
            <h2>Quote history</h2>
            <button
              type="button"
              className="ecd-disclose"
              aria-expanded={open.history}
              onClick={() => setOpen((prev) => ({ ...prev, history: !prev.history }))}
            >
              Details <i className="ti ti-chevron-down" />
            </button>
          </div>
          <div className={open.history ? 'ecd-body' : 'ecd-body collapsed'}>
            {history.length === 0 && <p className="ecd-wait">No quote has been sent yet.</p>}
            {history.length > 0 && (
              <div className="ecd-tl">
                {history.map((quote) => (
                  <div key={quote.id} className="ecd-tl-row">
                    <div>
                      <div style={{ fontWeight: 600 }}>{quoteHistoryLabel(quote, history)}</div>
                      <div className="ecd-wait" style={{ marginTop: 4 }}>
                        {dateShort(quote.createdAt)}
                        {quote.status === 'APPROVED' && paid ? ' · Accepted & paid' : ''}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600 }}>{money(quote.amountCents, quote.currency)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {filesFor && (
        <div className="sod-ov" role="presentation" onClick={() => setFilesFor(null)}>
          <div className="sod-mo" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3>Delivered files</h3>
              <button type="button" onClick={() => setFilesFor(null)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <p>Preview or download the files published for this item.</p>
            <div className="sod-flist">
              {deliveredFiles(filesFor).length === 0 && <div>No files are available yet.</div>}
              {deliveredFiles(filesFor).map((file) => (
                <div key={file.id} className="sod-file">
                  <span>{file.originalName}</span>
                  <span>
                    <button type="button" onClick={() => void previewFile(file.id)}>Preview</button>
                    <button
                      type="button"
                      onClick={() => void downloadSignedFile(myDeliveryFileUrl(order.id, file.id), file.originalName)}
                    >
                      Download
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="sod-mo-f">
              <button type="button" className="ecd-btn" onClick={() => setFilesFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
