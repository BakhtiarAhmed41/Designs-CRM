import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
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
import type { Delivery, Order } from '@/lib/types';
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

function requestSummary(design: EmbDesign, cutting: boolean, vector: boolean) {
  const sizes = filledSizes(design);
  if (sizes.length) {
    return sizes
      .map((size) => {
        const detail = sizeDetail(size);
        const detailText = detail !== 'Size' ? detail : '';
        if (cutting) return detailText;
        return [size.placement?.trim(), detailText].filter(Boolean).join(', ');
      })
      .filter(Boolean)
      .join(' · ');
  }
  if (vector) {
    return [backgroundLabel(design.background), colorModeLabel(design.colors)]
      .filter((part) => part && part !== '—')
      .join(' · ');
  }
  return '';
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

function methodChips(order: CustomerOrder) {
  const vias = new Set(releasedBatches(order).map((batch) => batch.deliveredVia));
  const chips: string[] = [];
  if (vias.has('PORTAL') || vias.has('BOTH')) chips.push('Portal Download');
  if (vias.has('EMAIL') || vias.has('BOTH')) chips.push('Email');
  return chips;
}

function headerStatus(order: CustomerOrder, delivered: number, total: number) {
  if (order.status === 'CANCELLED') return { text: 'Cancelled', ok: false };
  if (order.status === 'REJECTED') return { text: 'Rejected', ok: false };
  if (order.status === 'REFUNDED' || order.paymentStatus === 'REFUNDED') return { text: 'Refunded', ok: false };
  if (total > 0 && delivered === total) return { text: 'Delivered', ok: true };
  if (delivered > 0 && delivered < total) return { text: 'Partially delivered', ok: false };
  if (order.status === 'REVISION_REQUESTED') return { text: 'Revision requested', ok: false };
  if (
    order.status === 'PENDING_PAYMENT' ||
    order.paymentStatus === 'AWAITING' ||
    order.paymentStatus === 'UNPAID'
  ) {
    return { text: 'Awaiting payment', ok: false };
  }
  return { text: 'In progress', ok: false };
}

export function ServiceCustomerOrder({
  order,
  notice,
}: {
  order: CustomerOrder;
  notice?: 'paid' | 'confirming' | null;
}) {
  const kind: ServiceKind = serviceOrderKind(order) ?? 'embroidery';
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
  const serviceLabel = portalServiceLabel(kind);
  const designCount = groups.length || designs.length;
  const percent = counts.total > 0 ? Math.round((counts.delivered / counts.total) * 100) : 0;
  const header = headerStatus(order, counts.delivered, counts.total);
  const attachments: EmbAttachment[] = (order.attachments ?? []).map((file) => ({
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    previewUrl: file.previewUrl,
  }));
  const claimed = new Set<string>();
  const designFiles = designs.map((design) => filesForDesign(design, attachments, claimed));
  const history = [...quotations].sort((a, b) => a.version - b.version);
  const approved = [...history].reverse().find((quote) => quote.status === 'APPROVED') ?? null;
  const methods = methodChips(order);
  const bundleFiles = (order.deliveries ?? []).flatMap((batch) =>
    batch.files.filter((file) => file.isBundle),
  );

  const [filesFor, setFilesFor] = useState<DeliveryRow | null>(null);
  const [artworkFor, setArtworkFor] = useState<number | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
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
    (order.deliveries ?? []).flatMap((batch: Delivery) =>
      batch.files.filter((file) => file.designId && file.designId === row.design?.id && !file.isBundle),
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

  const artwork = artworkFor == null ? null : designs[artworkFor];
  const artworkFiles = artworkFor == null ? null : designFiles[artworkFor];

  return (
    <div className="ecd cop">
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

      <section className="cop-details">
        <h2>Order details</h2>

        <details name="order-details">
          <summary>
            Order summary <span className="cop-toggle" />
          </summary>
          <div className="cop-detail">
            <div className="cop-grid">
              <div>
                <b>Service</b>
                <span>{serviceLabel}</span>
              </div>
              <div>
                <b>Submitted</b>
                <span>{dateShort(order.createdAt)}</span>
              </div>
              <div>
                <b>Designs</b>
                <span>
                  {countWord(designCount, 'design', 'designs')}
                  {counts.total > 0 ? ` · ${countWord(counts.total, 'size', 'sizes')}` : ''}
                </span>
              </div>
              <div>
                <b>Current status</b>
                <span>{header.text}</span>
              </div>
            </div>
            <p className="cop-hint">The delivery status for each size is shown above.</p>
          </div>
        </details>

        <details name="order-details">
          <summary>
            Customer request <span className="cop-toggle" />
          </summary>
          <div className="cop-detail">
            {designs.map((design, index) => (
              <div key={`${design.name ?? 'design'}-${index}`} className="cop-req">
                <b>{designOptionLabel(index, design.name)}</b>
                <span>{requestSummary(design, cutting, vector) || 'Artwork and instructions'}</span>
                <button type="button" className="cop-link" onClick={() => setArtworkFor(index)}>
                  View artwork & instructions →
                </button>
              </div>
            ))}
          </div>
        </details>

        <details name="order-details">
          <summary>
            Delivery preferences <span className="cop-toggle" />
          </summary>
          <div className="cop-detail">
            <div className="cop-grid">
              <div>
                <b>Requested formats</b>
                {(prefs?.formats ?? []).length === 0 && <span>None selected</span>}
                {(prefs?.formats ?? []).length > 0 && (
                  <div className="cop-chips">
                    {(prefs?.formats ?? []).map((fmt) => (
                      <span key={fmt} className="cop-chip">{fmt}</span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <b>Delivery method</b>
                {methods.length === 0 && <span>Not delivered yet</span>}
                {methods.length > 0 && (
                  <div className="cop-chips">
                    {methods.map((method) => (
                      <span key={method} className="cop-chip">{method}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="cop-hint">Delivered files and email details for each size appear above.</p>
          </div>
        </details>

        <details name="order-details">
          <summary>
            Quote history <span className="cop-toggle" />
          </summary>
          <div className="cop-detail">
            <div className="cop-history">
              {approved && (
                <div>
                  <span className="cop-mark">✓</span>
                  <b>Quote approved</b>
                  <span>{dateShort(approved.createdAt)}</span>
                </div>
              )}
              <div>
                <span className="cop-mark">✓</span>
                <b>Order created</b>
                <span>{dateShort(order.createdAt)}</span>
              </div>
            </div>
            {approved && (
              <button type="button" className="cop-link" onClick={() => setQuoteOpen(true)}>
                View approved quote →
              </button>
            )}
            {!approved && history.length === 0 && <p className="cop-hint">No quote has been sent yet.</p>}
          </div>
        </details>
      </section>

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

      {artwork && artworkFiles && (
        <div className="sod-ov" role="presentation" onClick={() => setArtworkFor(null)}>
          <div className="sod-mo cop-wide" role="dialog" aria-modal="true" aria-labelledby="cop-artwork-title" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3 id="cop-artwork-title">{designOptionLabel(artworkFor ?? 0, artwork.name)}</h3>
              <button type="button" onClick={() => setArtworkFor(null)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <div className={artworkFiles.references.length > 0 ? 'ecd-assets' : undefined}>
              <div>
                <div className="ecd-label">Artwork</div>
                <div className="ecd-swatches">
                  {artworkFiles.artwork.map((file) => (
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
                  {artworkFiles.artwork.length === 0 && <div className="ecd-wait">No artwork uploaded.</div>}
                </div>
              </div>
              {artworkFiles.references.length > 0 && (
                <div>
                  <div className="ecd-label">Reference images</div>
                  <div className="ecd-swatches">
                    {artworkFiles.references.map((file) => (
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
              <dl className="ecd-pref cop-spec">
                <div>
                  <dt>Background</dt>
                  <dd>{backgroundLabel(artwork.background)}</dd>
                </div>
                <div>
                  <dt>Color Mode</dt>
                  <dd>{colorModeLabel(artwork.colors)}</dd>
                </div>
                <div>
                  <dt>Resolution</dt>
                  <dd>{resolutionLabel(artwork.dpi300)}</dd>
                </div>
              </dl>
            ) : (
              <table className={cutting ? 'ecd-table ecd-table-cut' : 'ecd-table'}>
                <thead>
                  <tr>
                    <th style={{ width: cutting ? '65%' : '40%' }}>Size or Placement</th>
                    {!cutting && <th>Embroidered on</th>}
                    <th><span className="ecd-prop">Proportional</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filledSizes(artwork).map((size, sizeIndex) => (
                    <tr key={`${size.detail ?? 'size'}-${sizeIndex}`}>
                      <td>
                        <span className="ecd-size-n">{sizeIndex + 1}</span>
                        {sizeDetail(size)}
                      </td>
                      {!cutting && <td>{size.placement || '—'}</td>}
                      <td>
                        {size.keepProportional === false ? 'No' : 'Yes'}
                      </td>
                    </tr>
                  ))}
                  {filledSizes(artwork).length === 0 && (
                    <tr>
                      <td colSpan={cutting ? 2 : 3}>No sizes added.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {artwork.notes?.trim() && <p className="ecd-note">{artwork.notes.trim()}</p>}
          </div>
        </div>
      )}

      {quoteOpen && approved && (
        <div className="sod-ov" role="presentation" onClick={() => setQuoteOpen(false)}>
          <div className="sod-mo cop-wide" role="dialog" aria-modal="true" aria-labelledby="cop-quote-title" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3 id="cop-quote-title">Approved quote</h3>
              <button type="button" onClick={() => setQuoteOpen(false)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            {(approved.lines ?? []).map((line) => (
              <div key={line.id} className="cop-qline">
                <span>{line.name}</span>
                <b>{money((line.priceCents ?? 0) + line.sizes.reduce((sum, size) => sum + size.priceCents, 0), approved.currency)}</b>
              </div>
            ))}
            <div className="cop-qline total">
              <span>Total</span>
              <b>{money(approved.amountCents, approved.currency)}</b>
            </div>
            {history.length > 1 && (
              <div className="cop-versions">
                {history.map((quote) => (
                  <div key={quote.id}>
                    <span>{quoteHistoryLabel(quote, history)}</span>
                    <span>{dateShort(quote.createdAt)}</span>
                    <b>{money(quote.amountCents, quote.currency)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {preview && (
        <ImageLightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
