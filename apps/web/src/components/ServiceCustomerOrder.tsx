import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { DetailsSectionHead } from '@/components/DesignNameTitle';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { ImageLightbox } from '@/components/FilePreview';
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
  type EmbDesign,
  type ServiceKind,
} from '@/lib/embroideryQuote';
import {
  dateShort,
  isImageFile,
  money,
  orderNumber,
  orderSlug,
} from '@/lib/format';
import { openLinkedChat } from '@/lib/messaging';
import { myAttachmentUrl, myDeliveryFilePreviewUrl, myDeliveryFileUrl } from '@/lib/orders';
import { isStaffCreatedOrder, quoteHistoryLabel, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import { deliveryCounts, orderDeliveryGroups, type DeliveryRow } from '@/lib/serviceOrderView';
import type { Order } from '@/lib/types';
import '@/styles/embroidery-quote.css';

type CustomerOrder = Order & { designs?: Design[] };

function portalServiceLabel(kind: ServiceKind) {
  if (kind === 'vector') return 'Vector & Print Artwork';
  if (kind === 'cutting') return 'Cutting & Engraving Files';
  return 'Embroidery Digitizing';
}

function countWord(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function filledSizes(design?: EmbDesign) {
  return (design?.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
}

function rowCaption(title: string, index: number, rowName: string, rowCount: number, designs: EmbDesign[]) {
  const design = designs.find((item, itemIndex) => designOptionLabel(itemIndex, item.name) === title);
  const sizes = filledSizes(design);
  if (design && sizes.length === rowCount) {
    const size = sizes[index];
    const place = size?.placement?.trim();
    const detail = size ? sizeDetail(size) : '';
    const parts = [place, detail && detail !== 'Size' ? detail : ''].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  const name = rowName.trim();
  if (!name || name === title) return '';
  return name;
}

function releasedBatches(order: CustomerOrder) {
  return (order.deliveries ?? []).filter((batch) => batch.releasedAt && batch.kind !== 'PREVIEW');
}

function emailOnlyDelivery(order: CustomerOrder, row: DeliveryRow) {
  if (row.design?.status !== 'DELIVERED') return false;
  const designId = row.design.id;
  const onPortal = releasedBatches(order).some((batch) => {
    if (batch.deliveredVia === 'EMAIL') return false;
    return batch.files.some((file) => {
      if (/^delivered by email$/i.test(file.originalName)) return false;
      if (file.isBundle) return true;
      return file.designId === designId;
    });
  });
  return !onPortal;
}

function rowStatus(order: CustomerOrder, row: DeliveryRow) {
  if (row.design?.status === 'DELIVERED') {
    return emailOnlyDelivery(order, row)
      ? { text: 'Delivered by email', ready: true }
      : { text: 'Delivered', ready: true };
  }
  return { text: 'In progress', ready: false };
}

export function ServiceCustomerOrder({
  order,
  notice,
}: {
  order: CustomerOrder;
  notice?: 'paid' | 'confirming' | null;
}) {
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
  const bundleFiles = (order.deliveries ?? []).flatMap((batch) =>
    batch.files.filter((file) => file.isBundle),
  );
  const serviceLabel = portalServiceLabel(kind);
  const designCount = groups.length || designs.length;
  const percent = counts.total > 0 ? Math.round((counts.delivered / counts.total) * 100) : 0;
  const header = counts.allDelivered
    ? { text: 'Delivered', ok: true }
    : awaiting
      ? { text: 'Awaiting payment', ok: false }
      : counts.delivered > 0 && counts.delivered < counts.total
        ? { text: 'Partially delivered', ok: false }
        : { text: 'In progress', ok: false };

  const [open, setOpen] = useState({
    summary: awaiting,
    request: false,
    delivery: false,
    history: false,
  });
  const [filesFor, setFilesFor] = useState<DeliveryRow | null>(null);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const topbarLead = useMemo(
    () => (
      <nav className="ecd-crumb" aria-label="Breadcrumb">
        <span>{serviceLabel}</span>
        <span aria-hidden="true">/</span>
        <Link to="/portal/orders">Orders</Link>
        <span aria-hidden="true">/</span>
        <b>{quoteNo}</b>
      </nav>
    ),
    [quoteNo, serviceLabel],
  );
  useTopbarLead(topbarLead);

  const chat = useMutation({
    mutationFn: () =>
      openLinkedChat({
        orderId: order.id,
        chatType: 'ORDER',
        label: 'HELP',
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
      if (res?.alreadyPaid) navigate(`/portal/orders/${orderSlug(order.humanRef, order.id)}`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPayBusy(false);
    }
  }

  async function previewFile(file: { id: string; originalName: string; mimeType?: string | null }) {
    setError(null);
    const image = isImageFile(file.originalName, file.mimeType);
    const tab = image ? null : window.open('', '_blank', 'noopener');
    try {
      const path = image
        ? myDeliveryFilePreviewUrl(order.id, file.id)
        : `${myDeliveryFileUrl(order.id, file.id)}?inline=1`;
      const { url } = await apiFetch<{ url: string }>(path);
      const abs = resolveFileUrl(url);
      if (image) {
        setPreview({ src: abs, name: file.originalName });
        return;
      }
      if (tab) tab.location.replace(abs);
      else window.location.assign(abs);
    } catch (e) {
      tab?.close();
      setError(getErrorMessage(e));
    }
  }

  return (
    <div className="ecd">
      {notice === 'paid' && (
        <div className="ecd-notice" role="status">
          <i className="ti ti-circle-check" />
          <div>
            <strong>Payment successful</strong>
            <span>Your order has been created.</span>
          </div>
        </div>
      )}
      {notice === 'confirming' && (
        <div className="ecd-notice wait" role="status">
          <i className="ti ti-loader" />
          <div>
            <strong>Confirming payment</strong>
            <span>This updates as soon as Stripe finishes.</span>
          </div>
        </div>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <section className="cop-head">
        <div className="cop-head-top">
          <div>
            <h1>Order progress</h1>
            <p className="cop-facts">
              {countWord(designCount, 'design', 'designs')}
              <span>·</span>
              Requested {dateShort(order.createdAt)}
              {isStaffCreatedOrder(order) && (
                <>
                  <span>·</span>
                  Created by the team
                </>
              )}
            </p>
          </div>
          <strong className={header.ok ? 'cop-pill ok' : 'cop-pill'}>{header.text}</strong>
        </div>
        {counts.total > 0 && (
          <div className="cop-progress">
            <div className="cop-progress-top">
              <strong>
                {counts.delivered} of {countWord(counts.total, 'size', 'sizes')} delivered
              </strong>
              <span>{percent}%</span>
            </div>
            <div
              className="cop-bar"
              role="progressbar"
              aria-label="Order delivery progress"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
        {awaiting && !paid && (
          <div className="cop-pay">
            <button type="button" className="ecd-btn pri" disabled={payBusy} onClick={() => void pay()}>
              <i className="ti ti-credit-card" /> {payBusy ? 'Opening checkout…' : 'Pay now'}
            </button>
          </div>
        )}
      </section>

      <h2 className="cop-title">Designs & files</h2>
      <div className="cop-designs">
        {groups.length === 0 && <p className="ecd-wait">No items on this order yet.</p>}
        {groups.map((group) => (
          <div key={group.title} className="cop-block">
            <div className="cop-dhead">{group.title}</div>
            {group.rows.map((row, index) => {
              const status = rowStatus(order, row);
              const caption = rowCaption(group.title, index, row.name, group.rows.length, designs);
              const delivered = row.design?.status === 'DELIVERED';
              return (
                <div key={row.key} className="cop-row">
                  <div className="cop-name">
                    Size {index + 1}
                    {caption && <span>{caption}</span>}
                  </div>
                  <div className={status.ready ? 'cop-state ready' : 'cop-state wait'}>
                    {status.ready ? '✓ ' : '● '}
                    {status.text}
                  </div>
                  <div className="cop-actions">
                    {delivered && (
                      <button type="button" className="cop-btn main" onClick={() => setFilesFor(row)}>
                        View & download
                      </button>
                    )}
                    <button
                      type="button"
                      className="cop-btn"
                      disabled={chat.isPending}
                      onClick={() => chat.mutate()}
                    >
                      {chat.isPending ? 'Opening…' : 'Request help'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <section className="cop-note" aria-label="Helpful information">
        <h2>Helpful to know</h2>
        <ul>
          <li>
            <strong>Delivered by email</strong> means the file was too large for the portal. We sent it to your email address.
          </li>
          <li>
            To see files from this and previous orders, open <Link to="/portal/files">My Files</Link>.
          </li>
          <li>
            For a question about a design, select <strong>Request help</strong> beside that design.
          </li>
        </ul>
      </section>

      <div className="ecd-sheet">
        <section className="ecd-sec">
          <DetailsSectionHead
            title="Order summary"
            description="Price, payment and order details"
            open={open.summary}
            onToggle={() => setOpen((prev) => ({ ...prev, summary: !prev.summary }))}
          />
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
          <DetailsSectionHead
            title="Customer request"
            description={
              vector
                ? 'Artwork, instructions and specifications'
                : 'Artwork, instructions and requested sizes'
            }
            open={open.request}
            onToggle={() => setOpen((prev) => ({ ...prev, request: !prev.request }))}
          />
          <div className={open.request ? 'ecd-body' : 'ecd-body collapsed'}>
            {designs.map((design, index) => {
              const files = designFiles[index] ?? { artwork: [], references: [] };
              const sizes = (design.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
              const hasRefs = files.references.length > 0;
              return (
                <div key={`${design.name ?? 'design'}-${index}`} className="ecd-design">
                  <h3>
                    <span className="ecd-num">{index + 1}.</span>
                    {designOptionLabel(index, design.name)}
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
                                <td>
                                  <span className="ecd-size-n">{sizeIndex + 1}</span>
                                  {sizeDetail(size)}
                                </td>
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
          <DetailsSectionHead
            title="Delivery preferences"
            description="Formats and delivery choices"
            open={open.delivery}
            onToggle={() => setOpen((prev) => ({ ...prev, delivery: !prev.delivery }))}
          />
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
          <DetailsSectionHead
            title="Quote history"
            description="Previous quotes and price revisions"
            open={open.history}
            onToggle={() => setOpen((prev) => ({ ...prev, history: !prev.history }))}
          />
          <div className={open.history ? 'ecd-body' : 'ecd-body collapsed'}>
            {history.length === 0 && <p className="ecd-wait">No quote has been sent yet.</p>}
            {history.length > 0 && (
              <div className="ecd-tl">
                {history.map((quote) => (
                  <div key={quote.id} className="ecd-tl-row">
                    <div>
                      <div className="ecd-tl-name">{quoteHistoryLabel(quote, history)}</div>
                      <div className="ecd-tl-sub">
                        {dateShort(quote.createdAt)}
                        {quote.status === 'APPROVED' && paid ? ' · Accepted & paid' : ''}
                      </div>
                    </div>
                    <div className="ecd-tl-price">{money(quote.amountCents, quote.currency)}</div>
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
            <p>
              {emailOnlyDelivery(order, filesFor)
                ? 'These files were delivered by email.'
                : 'Preview or download the files delivered for this item.'}
            </p>
            <div className="sod-flist">
              {deliveredFiles(filesFor).length === 0 && bundleFiles.length === 0 && (
                <div>
                  {emailOnlyDelivery(order, filesFor)
                    ? 'These files were delivered by email.'
                    : 'No files are available yet.'}
                </div>
              )}
              {deliveredFiles(filesFor).map((file) => (
                <div key={file.id} className="sod-file">
                  <span>{file.originalName}</span>
                  <span className="sod-file-acts">
                    <button
                      type="button"
                      className="sod-eye"
                      title="Preview"
                      aria-label={`Preview ${file.originalName}`}
                      onClick={() => void previewFile(file)}
                    >
                      <i className="ti ti-eye" />
                    </button>
                    <button
                      type="button"
                      className="sod-eye"
                      title="Download"
                      aria-label={`Download ${file.originalName}`}
                      onClick={() => void downloadSignedFile(myDeliveryFileUrl(order.id, file.id), file.originalName)}
                    >
                      <i className="ti ti-download" />
                    </button>
                  </span>
                </div>
              ))}
              {bundleFiles.map((file) => (
                <div key={file.id} className="sod-file">
                  <span>{file.originalName} (all designs)</span>
                  <span className="sod-file-acts">
                    <button
                      type="button"
                      className="sod-eye"
                      title="Download zip"
                      aria-label={`Download ${file.originalName}`}
                      onClick={() => void downloadSignedFile(myDeliveryFileUrl(order.id, file.id), file.originalName)}
                    >
                      <i className="ti ti-download" />
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
      {preview && (
        <ImageLightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
