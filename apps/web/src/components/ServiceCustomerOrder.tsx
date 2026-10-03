import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DesignNameTitle, DetailsSectionHead } from '@/components/DesignNameTitle';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { OrderSteps, RevisionSteps } from '@/components/QuoteJourney';
import { useTopbarLead } from '@/components/Shell';
import { ErrorBanner } from '@/components/ui/EmptyState';
import { apiFetch, downloadSignedFile, getErrorMessage, resolveFileUrl } from '@/lib/api';
import { goToInvoiceCheckout, goToOrderCheckout } from '@/lib/billing';
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
  type EmbSize,
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

function designForTitle(title: string, designs: EmbDesign[]) {
  return designs.find((item, itemIndex) => designOptionLabel(itemIndex, item.name) === title);
}

function placementLabel(size: EmbSize) {
  const place = size.placement?.trim();
  const detail = sizeDetail(size);
  const parts = [detail && detail !== 'Size' ? detail : '', place].filter(Boolean);
  return parts.join(' · ');
}

function libraryLines(group: { title: string; rows: DeliveryRow[] }, designs: EmbDesign[]) {
  const sizes = filledSizes(designForTitle(group.title, designs));
  if (!sizes.length) {
    return group.rows.map((row) => ({
      key: row.key,
      item: row.name.trim() || group.title,
      placement: '—',
      row,
    }));
  }
  return sizes.map((size, index) => ({
    key: `${group.rows[index]?.key ?? group.title}-size-${index}`,
    item: group.title,
    placement: placementLabel(size) || '—',
    row: group.rows[index] ?? group.rows[0],
  }));
}

function revisionCoversDesign(edit: EditRequest, designId?: string) {
  const ids = edit.designIds?.length ? edit.designIds : edit.designId ? [edit.designId] : [];
  if (ids.length === 0) return true;
  return Boolean(designId && ids.includes(designId));
}

function orderedRevisions(revisions: EditRequest[]) {
  return [...revisions].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
}

function openRevisionForDesign(revisions: EditRequest[], designId?: string) {
  const ordered = orderedRevisions(revisions);
  const match = ordered.find((edit) => edit.status !== 'DONE' && revisionCoversDesign(edit, designId));
  if (!match) return null;
  return { edit: match, number: ordered.findIndex((edit) => edit.id === match.id) + 1 };
}

function deliveredRevisionForDesign(revisions: EditRequest[], designId?: string) {
  const ordered = orderedRevisions(revisions);
  const done = ordered.filter((edit) => edit.status === 'DONE' && revisionCoversDesign(edit, designId));
  const match = done[done.length - 1];
  if (!match) return null;
  return { edit: match, number: ordered.findIndex((edit) => edit.id === match.id) + 1 };
}

function revisionProgressLabel(revisions: EditRequest[]) {
  const ordered = orderedRevisions(revisions);
  const open = ordered.filter((edit) => edit.status !== 'DONE');
  if (open.length === 0) return undefined;
  if (open.length === 1) {
    const number = ordered.findIndex((edit) => edit.id === open[0].id) + 1;
    return `Revision ${number} · In progress`;
  }
  return `${open.length} revisions · In progress`;
}

function revisionSettledLabel(revisions: EditRequest[], when: (edit: EditRequest) => string | null | undefined) {
  const ordered = orderedRevisions(revisions);
  if (ordered.length === 0 || ordered.some((edit) => edit.status !== 'DONE')) return undefined;
  const latest = ordered[ordered.length - 1];
  const date = dateShort(when(latest));
  if (ordered.length === 1) {
    return date ? `Revision 1 · Delivered ${date}` : 'Revision 1 · Delivered';
  }
  return date ? `${ordered.length} revisions · Delivered ${date}` : `${ordered.length} revisions · Delivered`;
}

function revisionSizeSummary(underRevision: number, delivered: number) {
  const parts: string[] = [];
  if (underRevision > 0) {
    parts.push(`${underRevision} ${underRevision === 1 ? 'size' : 'sizes'} under revision`);
  }
  if (delivered > 0) {
    parts.push(`${delivered} ${delivered === 1 ? 'size' : 'sizes'} delivered`);
  }
  return parts.join(' · ');
}

function librarySummary(
  designCount: number,
  sizeCount: number,
  deliveredDesigns: number,
  deliveredSizes: number,
) {
  const sizes = Math.max(sizeCount, designCount, 1);
  const designs = Math.max(designCount, 1);
  if (designs === 1 && sizes === 1) return `Design delivered: ${deliveredDesigns} of 1`;
  if (designs > 1 && sizes === designs) return `Designs delivered: ${deliveredDesigns} of ${designs}`;
  return `Sizes delivered: ${deliveredSizes} of ${sizes}`;
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

function isPreviewImage(file: { isBundle?: boolean; originalName?: string; mimeType?: string | null }) {
  return !isZipFile(file) && isImageFile(file.originalName, file.mimeType);
}

function customerFilesForRow(
  order: CustomerOrder,
  row: DeliveryRow,
  editId: string | null,
  revisions: EditRequest[],
) {
  const designId = row.design?.id;
  const batches = (order.deliveries ?? []).filter((batch) => {
    if (!batch.releasedAt) return false;
    if (editId) return revisionOwnerId(revisions, batch) === editId;
    if (batch.editId) return false;
    const real = batch.files.filter((file) => !/^delivered by email$/i.test(file.originalName));
    if (real.length === 0) return batch.kind !== 'PREVIEW' && (batch.deliveredVia === 'EMAIL' || batch.deliveredVia === 'BOTH');
    return real.some((file) => file.isBundle || file.designId === designId);
  });
  const keep = (file: { isBundle?: boolean; designId?: string | null; originalName: string }) =>
    !/^delivered by email$/i.test(file.originalName) && (Boolean(editId) || file.isBundle || file.designId === designId);
  const proofFiles = batches
    .filter((batch) => batch.kind === 'PREVIEW')
    .flatMap((batch) => batch.files.filter(keep));
  const finals = batches
    .filter((batch) => batch.kind !== 'PREVIEW')
    .flatMap((batch) => batch.files.filter(keep));
  const images = finals.filter(isPreviewImage);
  const production = finals.filter((file) => !isPreviewImage(file));
  const previews = production.length > 0 ? [...proofFiles, ...images] : proofFiles;
  const downloads = production.length > 0 ? production : finals.filter((file) => !proofFiles.some((proof) => proof.id === file.id));
  const emailed = ['EMAIL', 'BOTH'].includes(mergeDeliveredVia(batches.filter((batch) => batch.kind !== 'PREVIEW').map((batch) => batch.deliveredVia)) ?? '');
  return { previews, downloads, emailed };
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
  const designReady = (row: DeliveryRow) =>
    row.design?.status === 'DONE' || row.design?.status === 'DELIVERED' || sizeHasOriginalFiles(row);
  const designDelivered = (row: DeliveryRow) =>
    row.design?.status === 'DELIVERED' || sizeHasOriginalFiles(row);
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
  const [proof, setProof] = useState<{ title: string; detail: string; src: string; row: DeliveryRow } | null>(null);
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
  const deliveredDesignCount = groups.length
    ? groups.filter((group) => group.rows.length > 0 && group.rows.every(designDelivered)).length
    : deliveredDesigns;
  const originalsDelivered = designCount > 0 && deliveredDesignCount >= designCount;
  const showDesignProgress = !(originalsDelivered && revisions.length > 0);
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
  const revisionsSettled = revisions.length > 0 && revisions.every((edit) => edit.status === 'DONE');
  const header = revisionState === 'partial'
    ? { text: 'Partially delivered', ok: false }
    : revisionState === 'revision'
      ? { text: 'Revision in progress', ok: false, rev: true }
    : revisionsSettled
      ? { text: 'Revision delivered', ok: true, revised: true }
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

  function payRevision(edit: EditRequest) {
    if (!edit.invoiceId) return;
    setPayBusy(true);
    setError(null);
    goToInvoiceCheckout(edit.invoiceId, `/portal/orders/${orderSlug(order.humanRef, order.id)}`);
  }

  function pay() {
    setPayBusy(true);
    setError(null);
    goToOrderCheckout(order.id, `/portal/orders/${orderSlug(order.humanRef, order.id)}`);
  }

  const fileSplit = filesFor
    ? customerFilesForRow(order, filesFor.row, filesFor.editId, revisions)
    : null;
  const dialogFiles = fileSplit?.downloads ?? [];
  const sentThroughEmail = Boolean(fileSplit?.emailed);

  async function openProof(row: DeliveryRow, title: string, detail: string, editId: string | null = null) {
    const preview = customerFilesForRow(order, row, editId, revisions).previews[0]
      ?? customerFilesForRow(order, row, null, revisions).previews[0];
    if (!preview) return;
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(myDeliveryFilePreviewUrl(order.id, preview.id));
      setProof({ title, detail, src: resolveFileUrl(url), row });
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  const fileCards = groups.map((group) => {
    const lines = libraryLines(group, designs).map((line) => {
      const open = openRevisionForDesign(revisions, line.row?.design?.id);
      const finished = open ? null : deliveredRevisionForDesign(revisions, line.row?.design?.id);
      const delivered = Boolean(!open && (finished || (line.row && designDelivered(line.row))));
      return { ...line, open, finished, delivered };
    });
    const deliveredSizes = lines.filter((line) => line.delivered).length;
    const underRevision = lines.filter((line) => line.open).length;
    return {
      title: group.title,
      lines,
      deliveredSizes,
      underRevision,
      delivered: lines.length > 0 && deliveredSizes === lines.length,
    };
  });
  const revisionFiles = revisions.length > 0;
  const fileSummary = librarySummary(
    fileCards.length,
    fileCards.reduce((sum, card) => sum + card.lines.length, 0),
    fileCards.filter((card) => card.delivered).length,
    fileCards.reduce((sum, card) => sum + card.deliveredSizes, 0),
  );

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
      <div className="ecd-head">
        <div className="ecd-head-copy">
          <DesignNameTitle
            names={designs.map((design, index) => designOptionLabel(index, design.name))}
            fallback={order.name?.trim() || 'Order'}
          />
          <div className="ecd-meta">
            <span className={header.ok ? 'ecd-tag ok soft' : 'rev' in header && header.rev ? 'ecd-tag rev soft' : 'ecd-tag'}>
              {'revised' in header && header.revised && <i className="ti ti-check" aria-hidden />}
              {header.text}
            </span>
            <span className="ecd-sep" />
            <span>Requested {dateShort(order.createdAt)}</span>
            <span className="ecd-sep" />
            <span>{countWord(designCount, 'design', 'designs')}</span>
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
            <i className="ti ti-message" /> {chat.isPending ? 'Opening…' : 'Need help?'}
          </button>
        </div>
      </div>
      <section className="cop-head">
        {showDesignProgress && (
          <OrderSteps
            ready={
              groups.length
                ? groups.filter((group) => group.rows.length > 0 && group.rows.every(designReady)).length
                : readyDesigns
            }
            total={designCount}
            delivered={deliveredDesignCount}
          />
        )}
        {revisions.length > 0 && (
          <RevisionSteps
            ready={revisionReady}
            total={revisions.length}
            published={revisionPublished}
            awaitingPayment={awaitingRevisionPayment}
            progressLabel={
              revisionProgressLabel(revisions) ??
              revisionSettledLabel(revisions, (edit) => {
                if (edit.resolvedAt) return edit.resolvedAt;
                const batch = (order.deliveries ?? []).find(
                  (item) => item.releasedAt && revisionOwnerId(revisions, item) === edit.id,
                );
                return batch?.releasedAt;
              })
            }
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

      {revisions.some((revision) => revision.status !== 'DONE') && (
        <section className="cop-designs cop-revs" aria-label="Revision requests">
          <div className="cop-dhead">Revision requests</div>
          {revisions.filter((revision) => revision.status !== 'DONE').map((revision) => {
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
                        <i className="ti ti-download" /> Download files
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      )}

      <section className="cop-library" aria-label="Designs and files">
        <h2 className="cop-title">Designs & files</h2>
        <p className="cop-lead">
          {revisionFiles
            ? 'View your latest preview and download files when ready.'
            : 'Track each size and download your files when ready.'}
        </p>
        {groups.length === 0 && (
          <div className="cop-filecard">
            <p className="ecd-wait">No items on this order yet.</p>
          </div>
        )}
        {fileCards.map((card) => {
          const lines = card.lines;
          return (
            <article key={card.title} className="cop-filecard">
              <div className="cop-dname">
                <span>Design name</span>
                <strong>{card.title}</strong>
              </div>
              <div className="cop-table">
                <div className="cop-thead">
                  <span>Item</span>
                  <span>Size & placement</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {lines.map((line) => {
                  const row = line.row;
                  const open = line.open;
                  const finished = line.finished;
                  const keptFiles = Boolean(
                    row && (row.design?.status === 'DELIVERED' || sizeHasOriginalFiles(row)),
                  );
                  const revisedFiles = finished && row ? customerFilesForRow(order, row, finished.edit.id, revisions) : null;
                  const useRevised = Boolean(
                    revisedFiles && (revisedFiles.previews.length > 0 || revisedFiles.downloads.length > 0 || revisedFiles.emailed),
                  );
                  const files = useRevised
                    ? revisedFiles
                    : (open || finished || keptFiles) && row
                      ? customerFilesForRow(order, row, null, revisions)
                      : null;
                  const fileEditId = useRevised && finished ? finished.edit.id : null;
                  const status = open
                    ? { text: 'Revision in progress', tone: 'rev' as const }
                    : finished
                      ? { text: 'Revised files ready', tone: 'done' as const }
                      : line.delivered
                        ? { text: 'Delivered', tone: 'done' as const }
                        : row
                          ? rowStatus(order, row)
                          : { text: 'In progress', tone: 'wait' as const };
                  const previewLabel = open ? 'View previous preview' : 'View preview';
                  const downloadLabel = open ? 'Previous files' : 'Download files';
                  const updatedOn = finished
                    ? dateShort(finished.edit.resolvedAt ?? (order.deliveries ?? []).find(
                        (batch) => batch.releasedAt && revisionOwnerId(revisions, batch) === finished.edit.id,
                      )?.releasedAt)
                    : '';
                  return (
                    <div key={line.key} className={open || finished ? 'cop-row has-rev' : 'cop-row'}>
                      <div className="cop-item">
                        {line.item}
                        {open && (
                          <>
                            <span className="cop-item-note">
                              Revision {open.number} · Requested {dateShort(open.edit.createdAt)}
                            </span>
                            <span className="cop-item-help">
                              Your previous files remain available while we make your changes.
                            </span>
                          </>
                        )}
                        {finished && (
                          <span className="cop-item-note">
                            Revision {finished.number} · Updated {updatedOn}
                          </span>
                        )}
                      </div>
                      <div className="cop-place">{line.placement}</div>
                      <div className="cop-status-cell">
                        <span className={`cop-badge ${status.tone}`}>
                          {status.tone === 'done' ? (
                            <i className="ti ti-check" aria-hidden />
                          ) : (
                            <span className="cop-badge-dot" aria-hidden />
                          )}
                          {status.text}
                        </span>
                      </div>
                      <div className="cop-actions">
                        {files && files.previews.length > 0 && row && (
                          <button
                            type="button"
                            className="cop-btn"
                            onClick={() => void openProof(row, card.title, line.placement, fileEditId)}
                          >
                            <i className="ti ti-eye" /> {previewLabel}
                          </button>
                        )}
                        {files && row && (files.downloads.length > 0 || files.emailed) && (
                          <button
                            type="button"
                            className="cop-btn"
                            onClick={() => setFilesFor({ row, editId: fileEditId })}
                          >
                            <i className="ti ti-download" /> {downloadLabel}
                          </button>
                        )}
                        <button
                          type="button"
                          className="cop-btn help"
                          disabled={chat.isPending}
                          onClick={() => chat.mutate()}
                        >
                          <i className="ti ti-message" /> {chat.isPending ? 'Opening…' : 'Need help?'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {card.underRevision > 0 ? (
                <p className="cop-count">{revisionSizeSummary(card.underRevision, card.deliveredSizes)}</p>
              ) : (
                fileCards.length === 1 && <p className="cop-count">{fileSummary}</p>
              )}
            </article>
          );
        })}
        {fileCards.length > 1 && fileCards.every((card) => card.underRevision === 0) && (
          <p className="cop-count cop-count-all">{fileSummary}</p>
        )}
      </section>

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
            For a question about this order, select <strong>Need help?</strong> at the top of the page.
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
              {sentThroughEmail && dialogFiles.length === 0
                ? 'These files were sent to you through email.'
                : 'Files prepared in the formats requested for this design.'}
            </p>
            {dialogFiles.length === 0 && !sentThroughEmail && (
              <p>No files are available yet.</p>
            )}
            {(dialogFiles.length > 0 || (!filesFor.editId && emailOnlyDelivery(order, filesFor.row))) && (
              <div className="cdf-downloads">
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
      {proof && (
        <div className="sod-ov" role="presentation" onClick={() => setProof(null)}>
          <div className="sod-mo proof-mo" role="dialog" aria-modal="true" aria-labelledby="proof-title" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3 id="proof-title">{proof.title} — Preview</h3>
              <button type="button" onClick={() => setProof(null)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            {proof.detail && <p className="proof-detail">{proof.detail}</p>}
            <img className="proof-img" src={proof.src} alt="" />
            <p className="proof-note">Preview only. Download the production files to use this design.</p>
            <div className="sod-mo-f">
              <button type="button" className="ecd-btn" onClick={() => setProof(null)}>Close</button>
              {customerFilesForRow(order, proof.row, null, revisions).downloads.length > 0 && (
                <button
                  type="button"
                  className="ecd-btn pri"
                  onClick={() => {
                    setFilesFor({ row: proof.row, editId: null });
                    setProof(null);
                  }}
                >
                  <i className="ti ti-download" /> Download files
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
