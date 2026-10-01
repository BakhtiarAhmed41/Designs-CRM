import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DetailsSectionHead } from '@/components/DesignNameTitle';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { ImageLightbox } from '@/components/FilePreview';
import { OrderSteps, RevisionSteps } from '@/components/QuoteJourney';
import { useTopbarLead } from '@/components/Shell';
import { ErrorBanner } from '@/components/ui/EmptyState';
import { apiFetch, downloadSignedFile, getErrorMessage, resolveFileUrl } from '@/lib/api';
import { startMyInvoiceCheckout, startMyOrderCheckout } from '@/lib/billing';
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
  designDeliveredLabel,
  isImageFile,
  mergeDeliveredVia,
  money,
  orderNumber,
  orderSlug,
  revisionDeliveryState,
} from '@/lib/format';
import { listMyEdits, type EditRequest } from '@/lib/edits';
import { openLinkedChat } from '@/lib/messaging';
import { myAttachmentUrl, myDeliveryFilePreviewUrl, myDeliveryFileUrl } from '@/lib/orders';
import { isStaffCreatedOrder, quoteHistoryLabel, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import { freshOnOpen } from '@/lib/queryRefresh';
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

function isZipFile(file: { isBundle?: boolean; originalName?: string; mimeType?: string | null }) {
  if (file.isBundle) return true;
  const name = (file.originalName ?? '').toLowerCase();
  return name.endsWith('.zip') || file.mimeType === 'application/zip' || file.mimeType === 'application/x-zip-compressed';
}

function revisionDeliveredLabel(order: CustomerOrder, revisions: EditRequest[], revisionId: string) {
  const batches = (order.deliveries ?? []).filter((batch) => {
    if (!batch.releasedAt || batch.kind === 'PREVIEW') return false;
    return revisionOwnerId(revisions, batch) === revisionId;
  });
  const via = mergeDeliveredVia(batches.map((batch) => batch.deliveredVia));
  if (via === 'BOTH') return 'Delivered on portal & through email';
  if (via === 'EMAIL') return 'Delivered through email';
  if (via === 'PORTAL') return 'Delivered on portal';
  return 'Delivered';
}

function revisionOwnerId(
  revisions: EditRequest[],
  batch: { editId?: string | null; createdAt?: string },
) {
  if (batch.editId) return batch.editId;
  const at = batch.createdAt ? new Date(batch.createdAt).getTime() : 0;
  let owner: string | null = null;
  for (const edit of revisions) {
    if (at >= new Date(edit.createdAt).getTime() - 2000) owner = edit.id;
  }
  return owner;
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
    return {
      text: designDeliveredLabel(order.deliveries, row.design.id),
      tone: 'done' as const,
    };
  }
  if (row.design?.status === 'DONE') {
    return { text: 'Ready', tone: 'ready' as const };
  }
  return { text: 'In progress', tone: 'wait' as const };
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
  const serviceLabel = portalServiceLabel(kind);
  const designCount = groups.length || designs.length;
  const sizeRows = groups.flatMap((group) => group.rows);
  const sizeHasOriginalFiles = (row: DeliveryRow) => {
    const designId = row.design?.id;
    if (!designId) return false;
    return (order.deliveries ?? []).some(
      (batch) =>
        Boolean(batch.releasedAt) &&
        batch.kind !== 'PREVIEW' &&
        !batch.editId &&
        batch.files.some((file) => !file.isBundle && file.designId === designId),
    );
  };
  const deliveredSizes = sizeRows.filter(
    (row) => row.design?.status === 'DELIVERED' || sizeHasOriginalFiles(row),
  ).length;
  const linked = sizeRows.map((row) => row.design).filter(Boolean) as Design[];
  const tracked = (linked.length ? linked : order.designs ?? []) as Design[];
  const readyDesigns = tracked.filter(
    (design) => design.status === 'DONE' || design.status === 'DELIVERED',
  ).length;
  const deliveredDesigns = tracked.filter((design) => design.status === 'DELIVERED').length;

  const [open, setOpen] = useState({
    summary: awaiting,
    request: false,
    delivery: false,
    history: false,
  });
  const [filesFor, setFilesFor] = useState<{ row: DeliveryRow; editId: string | null } | null>(null);
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

  const editsQ = useQuery({
    queryKey: ['my-order-edits', order.id],
    queryFn: () => listMyEdits(order.id),
    ...freshOnOpen,
  });
  const revisions = editsQ.data?.edits ?? [];
  const revisionReady = revisions.filter((edit) => edit.status === 'DONE' || Boolean(edit.readyAt)).length;
  const revisionPublished = revisions.filter((edit) => edit.status === 'DONE').length;
  const awaitingRevisionPayment =
    revisions.length > 0 &&
    revisionReady === 0 &&
    revisions.every(
      (edit) =>
        edit.kind === 'PAID' &&
        (edit.priceCents ?? 0) > 0 &&
        edit.invoiceStatus !== 'PAID' &&
        edit.status !== 'DONE',
    );
  const revisionState = revisionDeliveryState(revisions, (id) => {
    const row = groups.flatMap((group) => group.rows).find((item) => item.design?.id === id);
    return row?.design?.status ?? order.designs?.find((design) => design.id === id)?.status;
  });
  const header = revisionState === 'partial'
    ? { text: 'Partially delivered', ok: false }
    : revisionState === 'revision'
      ? { text: 'Revision requested', ok: false }
    : counts.allDelivered
      ? { text: 'Delivered', ok: true }
      : awaiting
        ? { text: 'Awaiting payment', ok: false }
        : counts.delivered > 0 && counts.delivered < counts.total
          ? { text: 'Partially delivered', ok: false }
          : { text: 'In progress', ok: false };

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

  async function payRevision(edit: EditRequest) {
    if (!edit.invoiceId) return;
    setPayBusy(true);
    setError(null);
    try {
      const res = await startMyInvoiceCheckout(
        edit.invoiceId,
        `/portal/orders/${orderSlug(order.humanRef, order.id)}`,
      );
      if (res?.alreadyPaid) {
        window.location.assign(`/portal/orders/${orderSlug(order.humanRef, order.id)}`);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPayBusy(false);
    }
  }

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

  const dialogBatches = !filesFor
    ? []
    : (order.deliveries ?? []).filter((batch) => {
        if (!batch.releasedAt || batch.kind === 'PREVIEW') return false;
        if (filesFor.editId) return revisionOwnerId(revisions, batch) === filesFor.editId;
        if (batch.editId) return false;
        const designId = filesFor.row.design?.id;
        const real = batch.files.filter((file) => !/^delivered by email$/i.test(file.originalName));
        if (real.length === 0) return batch.deliveredVia === 'EMAIL' || batch.deliveredVia === 'BOTH';
        return real.some((file) => file.isBundle || file.designId === designId);
      });
  const dialogFiles = dialogBatches.flatMap((batch) => {
    const files = filesFor?.editId
      ? batch.files
      : batch.files.filter((file) => file.isBundle || file.designId === filesFor?.row.design?.id);
    return files.filter((file) => !/^delivered by email$/i.test(file.originalName));
  });
  const previewFiles = dialogFiles.filter((file) => !isZipFile(file) && isImageFile(file.originalName, file.mimeType));
  const sentThroughEmail = ['EMAIL', 'BOTH'].includes(
    mergeDeliveredVia(dialogBatches.map((batch) => batch.deliveredVia)) ?? '',
  );

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
      <div className="cop-help-row">
        <button type="button" className="ecd-btn pri" disabled={chat.isPending} onClick={() => chat.mutate()}>
          <i className="ti ti-message" /> {chat.isPending ? 'Opening…' : 'Request help'}
        </button>
      </div>
      <section className="cop-head">
        <div className="cop-head-top">
          <div>
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
        <OrderSteps
          ready={readyDesigns}
          total={tracked.length}
          delivered={deliveredDesigns}
          sizeDelivered={deliveredSizes}
          sizeTotal={counts.total}
        />
        {revisions.length > 0 && (
          <RevisionSteps
            ready={revisionReady}
            total={revisions.length}
            published={revisionPublished}
            awaitingPayment={awaitingRevisionPayment}
          />
        )}
        {awaiting && !paid && (
          <div className="cop-pay">
            <button type="button" className="ecd-btn pri" disabled={payBusy} onClick={() => void pay()}>
              <i className="ti ti-credit-card" /> {payBusy ? 'Opening checkout…' : 'Pay now'}
            </button>
          </div>
        )}
      </section>

      {revisions.length > 0 && (
        <section className="cop-designs cop-revs" aria-label="Revision requests">
          <div className="cop-dhead">Revision requests</div>
          {revisions.map((revision) => {
            const ids = revision.designIds?.length
              ? revision.designIds
              : revision.designId
                ? [revision.designId]
                : [];
            const covered = sizeRows.filter((row) => Boolean(row.design && ids.includes(row.design.id)));
            const ready = revision.status !== 'DONE' && Boolean(revision.readyAt);
            const published = revision.status === 'DONE';
            const charged = revision.kind === 'PAID' && (revision.priceCents ?? 0) > 0;
            const settled = revision.invoiceStatus === 'PAID';
            const tone = published ? 'done' : ready ? 'ready' : 'wait';
            const label = published
              ? revisionDeliveredLabel(order, revisions, revision.id)
              : ready
                ? 'Ready'
                : 'In progress';
            const viewRow = covered[0] ?? sizeRows[0];
            return (
              <div key={revision.id} className="cop-rev-row">
                <div className="cop-rev-note">{revision.note}</div>
                <div className="cop-rev-meta">
                  {charged ? (
                    <>
                      <b className="cop-rev-price">{money(revision.priceCents, order.currency)}</b>
                      <span className={settled ? 'cop-mini paid' : 'cop-mini unpaid'}>{settled ? 'Paid' : 'Unpaid'}</span>
                    </>
                  ) : (
                    <span className="cop-rev-free">Free revision</span>
                  )}
                  <span className={`cop-state ${tone}`}>{tone === 'done' ? '✓ ' : '● '}{label}</span>
                </div>
                {(charged && !settled) || (published && viewRow) ? (
                  <div className="cop-actions">
                    {charged && !settled && (
                      <button
                        type="button"
                        className="cop-btn cop-download"
                        disabled={payBusy || !revision.invoiceId}
                        onClick={() => void payRevision(revision)}
                      >
                        <i className="ti ti-credit-card" /> {payBusy ? 'Opening checkout…' : 'Pay now'}
                      </button>
                    )}
                    {published && viewRow && (
                      <button
                        type="button"
                        className="cop-btn cop-download"
                        onClick={() => setFilesFor({ row: viewRow, editId: revision.id })}
                      >
                        View & download
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      )}

      <h2 className="cop-title">Designs & files</h2>
      <div className="cop-designs">
        {groups.length === 0 && <p className="ecd-wait">No items on this order yet.</p>}
        {groups.map((group) => {
          return (
            <div key={group.title} className="cop-block">
              <div className="cop-dhead">{group.title}</div>
              {group.rows.map((row, index) => {
                const rowDelivered = row.design?.status === 'DELIVERED' || sizeHasOriginalFiles(row);
                const status = rowDelivered
                  ? { text: designDeliveredLabel(order.deliveries, row.design?.id), tone: 'done' as const }
                  : rowStatus(order, row);
                const caption = rowCaption(group.title, index, row.name, group.rows.length, designs);
                return (
                  <div key={row.key} className="cop-row">
                    <div className="cop-name">
                      Size {index + 1}
                      {caption && <span>{caption}</span>}
                    </div>
                    <div className={`cop-state ${status.tone}`}>
                      {status.tone === 'done' ? '✓ ' : '● '}
                      {status.text}
                    </div>
                    <div className="cop-actions">
                      {rowDelivered && (
                        <button
                          type="button"
                          className="cop-btn cop-download"
                          onClick={() => setFilesFor({ row, editId: null })}
                        >
                          View & download
                        </button>
                      )}
                      <button
                        type="button"
                        className="cop-btn help"
                        disabled={chat.isPending}
                        onClick={() => chat.mutate()}
                      >
                        Request help
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
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
            For a question about this order, select <strong>Request help</strong> at the top of the page.
          </li>
        </ul>
      </section>

      <div className="ecd-sheet ecd-summary">
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
            title="Designs Details"
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
            {history.length === 0 && revisions.length === 0 && <p className="ecd-wait">No quote has been sent yet.</p>}
            {(history.length > 0 || revisions.length > 0) && (
              <div className="ecd-tl">
                {history.map((quote) => (
                  <div key={quote.id} className="ecd-tl-row">
                    <div>
                      <div className="ecd-tl-name">{quoteHistoryLabel(quote, history)}</div>
                      <div className="ecd-tl-sub">
                        {dateShort(quote.createdAt)}
                        {quote.status === 'APPROVED' && paid ? ' · Accepted & paid' : quote.status === 'SENT' ? ' · Sent' : ''}
                      </div>
                    </div>
                    <div className="ecd-tl-price">{money(quote.amountCents, quote.currency)}</div>
                  </div>
                ))}
                {revisions.map((edit) => {
                  const charged = edit.kind === 'PAID' && (edit.priceCents ?? 0) > 0;
                  return (
                    <div key={edit.id} className="ecd-tl-row">
                      <div>
                        <div className="ecd-tl-name">{charged ? 'Paid revision' : 'Free revision'}</div>
                        <div className="ecd-tl-sub">
                          {dateShort(edit.createdAt)} · {edit.note}
                          {charged
                            ? edit.invoiceStatus === 'PAID'
                              ? ' · Accepted & paid'
                              : ' · Awaiting payment'
                            : ' · No charge'}
                        </div>
                      </div>
                      <div className="ecd-tl-price">{charged ? money(edit.priceCents, order.currency) : 'Free'}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {filesFor && (
        <div className="sod-ov" role="presentation" onClick={() => setFilesFor(null)}>
          <div className="sod-mo cdf-mo" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3>Delivered files</h3>
              <button type="button" onClick={() => setFilesFor(null)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <p>
              {sentThroughEmail && previewFiles.length === 0
                ? 'These files were sent to you through email.'
                : 'Preview the design, then download the files prepared for your order.'}
            </p>
            {previewFiles.length === 0 && dialogFiles.length === 0 && !sentThroughEmail && (
              <p>No files are available yet.</p>
            )}
            {previewFiles.length > 0 && (
              <div className="cdf-preview">
                <div className="cdf-kicker">Design preview</div>
                {previewFiles.map((file) => (
                  <div key={file.id} className="cdf-row">
                    <span>{file.originalName}</span>
                    <button
                      type="button"
                      className="cdf-preview-btn"
                      onClick={() => void previewFile(file)}
                    >
                      Preview
                    </button>
                  </div>
                ))}
              </div>
            )}
            {(dialogFiles.length > 0 || (!filesFor.editId && emailOnlyDelivery(order, filesFor.row))) && (
              <div className="cdf-downloads">
                <div className="cdf-kicker">Your download files</div>
                <p className="cdf-note">Files prepared in the formats requested for this design.</p>
                {dialogFiles.map((file) => (
                  <div key={file.id} className="cdf-row cdf-dl-row">
                    <span>{file.originalName}{file.isBundle ? ' · All designs' : ''}</span>
                    <button
                      type="button"
                      className="ecd-btn pri cdf-dl-btn"
                      onClick={() => void downloadSignedFile(myDeliveryFileUrl(order.id, file.id), file.originalName)}
                    >
                      Download
                    </button>
                  </div>
                ))}
                {dialogFiles.length === 0 && (
                  <div className="cdf-row cdf-dl-row">
                    <span>Sent by email · all files</span>
                  </div>
                )}
              </div>
            )}
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
