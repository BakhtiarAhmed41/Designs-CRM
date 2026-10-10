import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminCounterDecision } from '@/components/AdminCounterDecision';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { QuoteJourney } from '@/components/QuoteJourney';
import { useDialog } from '@/components/ui/AppDialog';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { useAuth } from '@/context/AuthContext';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import type { CustomerDetail } from '@/lib/customers';
import { submitQuoteBuilder } from '@/lib/designs';
import { clipDesignLabel, dateShort, money, orderNumber, orderSlug } from '@/lib/format';
import {
  asEmbroideryPrefs,
  backgroundLabel,
  colorModeLabel,
  designCountLabel,
  customerDesignTitle,
  designNote,
  designOptionLabel,
  embroideryDesigns,
  filesForDesign,
  parseDesignNote,
  resolutionLabel,
  sizeDetail,
  turnaroundLabel,
  type EmbAttachment,
} from '@/lib/embroideryQuote';
import { createAdminConversation, listAdminConversations } from '@/lib/messaging';
import {
  adminAcceptQuotation,
  adminAttachmentUrl,
  adminRejectOrder,
  approveCounter,
  deleteAdminOrder,
  updateOrderNotes,
} from '@/lib/orders';
import { applyOrderChange, invalidateWorkCaches } from '@/lib/queryCache';
import { canSupport } from '@/lib/permissions';
import { quoteJourneyPhase, staffJourneyLines } from '@/lib/quoteJourney';
import { isStaffCreatedOrder, lineTotal, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import type { Order } from '@/lib/types';
import '@/styles/embroidery-quote.css';
import '@/styles/quote-journey.css';

function draftStorageKey(orderId: string) {
  return `admin-quote-draft:${orderId}`;
}

type PriceRow = { key: string; description: string; price: string };
type DesignBlock = { key: string; designKey: string; rows: PriceRow[] };

function newKey() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyRow(): PriceRow {
  return { key: newKey(), description: '', price: '' };
}

function dateStamp(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function orderStatusLabel(status: string) {
  if (status === 'COMPLETED' || status === 'CLOSED') return 'Delivered';
  if (status === 'IN_PROGRESS' || status === 'READY_TO_SEND') return 'In progress';
  if (status === 'PENDING_PAYMENT') return 'Awaiting payment';
  return status.replace(/_/g, ' ').toLowerCase();
}

function companyName(preferences: unknown) {
  if (!preferences || typeof preferences !== 'object') return null;
  const rec = preferences as Record<string, unknown>;
  for (const key of ['company', 'companyName', 'businessName']) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function blocksFromQuote(quote: QuoteWithLines | undefined, options: string[]): DesignBlock[] {
  const lines = quote?.lines ?? [];
  if (lines.length === 0) {
    const keys = options.length ? options : [''];
    return keys.map((designKey) => ({ key: newKey(), designKey, rows: [emptyRow()] }));
  }
  const blocks: DesignBlock[] = [];
  for (const line of lines) {
    const stored = parseDesignNote(line.note);
    const designKey = stored ? customerDesignTitle(stored) : (options[0] ?? '');
    let block = blocks.find((b) => b.designKey === designKey);
    if (!block) {
      block = { key: newKey(), designKey, rows: [] };
      blocks.push(block);
    }
    block.rows.push({
      key: line.id,
      description: line.name,
      price: line.priceCents != null ? (line.priceCents / 100).toFixed(2) : '',
    });
  }
  return blocks;
}

export function EmbroideryAdminQuote({
  order,
  customer,
  kind = 'embroidery',
}: {
  order: Order;
  customer?: CustomerDetail;
  kind?: 'embroidery' | 'cutting' | 'vector';
}) {
  const cutting = kind === 'cutting';
  const vector = kind === 'vector';
  const dialog = useDialog();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canApproveCounter = canSupport(user?.permissions, 'approve', user?.role);
  const prefs = asEmbroideryPrefs(order.preferences);
  const designs = embroideryDesigns(order.preferences, order.name);
  const options = designs.map((d, i) => designOptionLabel(i, d.name));
  const attachments: EmbAttachment[] = (order.attachments ?? []).map((a) => ({
    id: a.id,
    name: a.originalName,
    mimeType: a.mimeType,
    previewUrl: a.previewUrl,
  }));
  const quotations = (order.quotations ?? []) as QuoteWithLines[];
  const studio = studioQuotation(quotations);
  const latest = [...quotations].sort((a, b) => b.version - a.version)[0];
  const awaitingCounter = order.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL';
  const declined = order.status === 'REJECTED' || order.status === 'CANCELLED';
  const sentVersion = studio && order.status === 'QUOTATION_PROVIDED' ? studio.version : 0;

  const [blocks, setBlocks] = useState<DesignBlock[]>(() => blocksFromQuote(studio, options));
  const [notes, setNotes] = useState(order.internalNotes ?? '');
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(order.internalNotes?.trim()));
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    setNotes(order.internalNotes ?? '');
    setNotesOpen(Boolean(order.internalNotes?.trim()));
  }, [order.internalNotes, order.id]);

  useEffect(() => {
    setBlocks(blocksFromQuote(studio, options));
    setEditing(false);
    // Refill when a newly sent quote comes back on this order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio?.id]);

  useEffect(() => {
    if (studio?.id) return;
    try {
      const raw = window.localStorage.getItem(draftStorageKey(order.id));
      if (!raw) return;
      const parsed = JSON.parse(raw) as DesignBlock[];
      if (Array.isArray(parsed) && parsed.length) setBlocks(parsed);
    } catch {
      /* ignore bad draft */
    }
  }, [order.id, studio?.id]);

  const totalCents = useMemo(() => {
    let total = 0;
    for (const block of blocks) {
      for (const row of block.rows) {
        const n = parseFloat(row.price);
        if (!Number.isNaN(n)) total += Math.round(n * 100);
      }
    }
    return total;
  }, [blocks]);

  const claimed = new Set<string>();
  const designFiles = designs.map((design) => filesForDesign(design, attachments, claimed));

  const history = useMemo(() => {
    const staff = quotations
      .filter((q) => q.createdByRole !== 'CLIENT')
      .sort((a, b) => a.version - b.version);
    return staff.map((q, i) => {
      const prev = i === 0 ? null : staff[i - 1]?.amountCents;
      const amount = q.amountCents ?? 0;
      if (prev == null) return { quote: q, kind: 'first' as const, delta: 0, pct: 0 };
      const delta = amount - prev;
      if (Math.abs(delta) < 1) return { quote: q, kind: 'same' as const, delta: 0, pct: 0 };
      return {
        quote: q,
        kind: delta > 0 ? ('up' as const) : ('down' as const),
        delta,
        pct: prev ? (delta / prev) * 100 : 0,
      };
    });
  }, [quotations]);

  const pastOrders = (customer?.recentOrders ?? []).filter((item) => item.id !== order.id);
  const shownPastCount = customer?.ordersCount ?? pastOrders.length;
  const clientName = [order.client?.firstName, order.client?.lastName].filter(Boolean).join(' ');
  const company = companyName(customer?.preferences);

  const sendQuote = useMutation({
    mutationFn: async () => {
      if (blocks.some((block) => !block.designKey)) {
        throw new Error('Select a design for each price group.');
      }
      const lines = blocks.flatMap((block) =>
        block.rows
          .filter((row) => row.description.trim() || row.price.trim())
          .map((row) => {
            const amount = row.price.trim() ? Number(row.price) : 0;
            if (!Number.isFinite(amount) || amount < 0) {
              throw new Error('Enter a valid price for each item.');
            }
            return {
              name: row.description.trim(),
              note: designNote(block.designKey),
              priceCents: Math.round(amount * 100),
            };
          }),
      );
      if (lines.some((line) => !line.name)) {
        throw new Error('Add a description for each priced item.');
      }
      if (lines.length === 0 || lines.every((line) => !line.priceCents)) {
        throw new Error('Add a description and price before sending the quote.');
      }
      return submitQuoteBuilder(order.id, { lines });
    },
    onSuccess: (res) => {
      setError(null);
      setEditing(false);
      try {
        window.localStorage.removeItem(draftStorageKey(order.id));
      } catch {
        /* ignore */
      }
      const revising = sentVersion > 0;
      void applyOrderChange(qc, res.order);
      void dialog.alert({
        title: revising ? 'Revised quote sent' : 'Quote sent',
        message: revising
          ? 'The customer will be notified of the updated quote.'
          : 'The customer can now review and accept this quote.',
        confirmLabel: 'Done',
        tone: 'success',
      });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const declineMut = useMutation({
    mutationFn: () => adminRejectOrder(order.id, { reason: 'Declined by staff', status: 'REJECTED' }),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      navigate('/admin/quotes');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteAdminOrder(order.id),
    onSuccess: () => {
      void invalidateWorkCaches(qc);
      navigate('/admin/quotes');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const approveForCustomer = useMutation({
    mutationFn: () => adminAcceptQuotation(order.id),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      navigate(`/admin/orders/${orderSlug(res.order.humanRef, res.order.id)}`);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const counterApprove = useMutation({
    mutationFn: () => approveCounter(order.id),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      navigate(`/admin/orders/${orderSlug(order.humanRef, order.id)}`);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const notesMut = useMutation({
    mutationFn: () => updateOrderNotes(order.id, notes),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      setNotesSaved(true);
      window.setTimeout(() => setNotesSaved(false), 1500);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  async function messageCustomer() {
    setMessaging(true);
    setError(null);
    try {
      const existing = await listAdminConversations({ orderId: order.id });
      const found = existing.conversations.find((c) => c.orderId === order.id);
      if (found) {
        navigate(`/admin/messages/customers/${found.id}`);
        return;
      }
      const created = await createAdminConversation({
        orderId: order.id,
        customerId: order.customerId ?? null,
        chatType: 'QUOTE',
        subject: order.humanRef ? `Quotation ${orderNumber(order.humanRef)} Chat` : 'Quotation Chat',
      });
      navigate(`/admin/messages/customers/${created.conversation.id}`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setMessaging(false);
    }
  }

  async function downloadAll(files: EmbAttachment[]) {
    for (const file of files) {
      try {
        await downloadSignedFile(adminAttachmentUrl(order.id, file.id), file.name, { stayOnPage: true });
      } catch (e) {
        setError(getErrorMessage(e));
        break;
      }
    }
  }

  const isOrder = order.type === 'ORDER';
  const phaseRaw = quoteJourneyPhase(order);
  const livePhase =
    phaseRaw === 'closed'
      ? null
      : isOrder
        ? order.paymentStatus === 'PAID'
          ? ('paid' as const)
          : phaseRaw === 'pay'
            ? ('pay' as const)
            : ('accepted' as const)
        : phaseRaw;
  const revised = (studio?.version ?? 0) > 1;
  const showBuilder = !isOrder && !declined && (sentVersion === 0 || editing);
  const orderTo = `/admin/orders/${orderSlug(order.humanRef, order.id)}`;
  const serviceCrumb = vector
    ? 'Vector & Print Artwork'
    : cutting
      ? 'CNC Laser Cutting'
      : 'Embroidery Digitizing';
  const project = clipDesignLabel(
    order.name?.trim() || designs[0]?.name?.trim() || (vector ? 'Vector quote' : cutting ? 'Cutting quote' : 'Embroidery quote'),
  );
  const quoteNo = orderNumber(order.humanRef, order.id.slice(0, 6));
  const studioLines = studio?.lines ?? [];
  const quotedTotal = studio?.amountCents ?? order.priceCents ?? totalCents;
  const sendLabel = sendQuote.isPending ? 'Sending…' : 'Send quote';
  const approved = isOrder || livePhase === 'paid' || livePhase === 'accepted';

  const pill = declined
    ? { text: 'Declined', cls: 'ead-pill' }
    : awaitingCounter
      ? { text: 'Counter to review', cls: 'ead-pill' }
      : approved
        ? { text: 'Approved', cls: 'ead-pill ok' }
        : sentVersion > 0
          ? { text: 'Awaiting approval', cls: 'ead-pill review' }
          : { text: 'Needs pricing', cls: 'ead-pill' };

  const journeyLines = livePhase
    ? staffJourneyLines({
        phase: livePhase,
        revised,
        version: studio?.version,
        sentAt: studio?.createdAt ? dateShort(studio.createdAt) : null,
        paidAt: order.updatedAt ? dateShort(order.updatedAt) : null,
        totalLabel: money(quotedTotal),
      })
    : {};

  function saveDraft() {
    try {
      window.localStorage.setItem(draftStorageKey(order.id), JSON.stringify(blocks));
      setDraftSaved(true);
      window.setTimeout(() => setDraftSaved(false), 1600);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  function startEdit() {
    setBlocks(blocksFromQuote(studio, options));
    setEditing(true);
  }

  return (
    <div className="ead ead-desk">
      <nav className="ead-crumb" aria-label="Breadcrumb">
        <Link to="/admin/quotes">Quotes</Link>
        <span aria-hidden>/</span>
        <span>{serviceCrumb}</span>
        <span aria-hidden>/</span>
        <b>{quoteNo}</b>
      </nav>

      <div className="ead-head">
        <div className="ead-head-copy">
          <h1 title={project.full}>{project.text}</h1>
          <div className="ead-meta">
            <span className={pill.cls}>{pill.text}</span>
            <span className="ead-sep" />
            <span>Requested {dateShort(order.createdAt)}</span>
            <span className="ead-sep" />
            <span>{designCountLabel(designs.length).toLowerCase()}</span>
            {isStaffCreatedOrder(order) && (
              <>
                <span className="ead-sep" />
                <span>Created by admin</span>
              </>
            )}
          </div>
        </div>
        <div className="ead-acts">
          <button type="button" className="ead-btn pri" disabled={messaging} onClick={() => void messageCustomer()}>
            <i className="ti ti-message" /> {messaging ? 'Opening…' : 'Contact Customer'}
          </button>
          {!isOrder && (
            <button
              type="button"
              className="ead-btn icon"
              title="Delete Request"
              aria-label="Delete Request"
              disabled={deleteMut.isPending}
              onClick={() => {
                void dialog
                  .confirm({
                    title: 'Delete this quote?',
                    message: 'This cannot be undone.',
                    confirmLabel: 'Delete',
                    danger: true,
                  })
                  .then((ok) => {
                    if (ok) deleteMut.mutate();
                  });
              }}
            >
              <i className="ti ti-trash" />
            </button>
          )}
        </div>
      </div>

      {error && <div className="ead-banner">{error}</div>}

      {livePhase && (
        <QuoteJourney
          phase={livePhase}
          orderTo={orderTo}
          audience="staff"
          revised={revised}
          subtitle={journeyLines.subtitle}
          meta={journeyLines.meta}
        />
      )}

      <div className="ead-grid">
        <div className="ead-col">
          <section className="ead-card">
            <div className="ead-card-h">
              <h2>Customer request details</h2>
            </div>
            {designs.map((design, index) => {
              const files = designFiles[index] ?? { artwork: [], references: [] };
              const all = [...files.artwork, ...files.references];
              const sizes = (design.sizes ?? []).filter((s) => s.detail || s.placement || s.w || s.h);
              const gallery = [
                ...files.artwork.map((file, fileIndex) => ({
                  file,
                  label: cutting || vector || fileIndex === 0 ? 'Main artwork' : 'Alternate artwork',
                })),
                ...files.references.map((file, fileIndex) => ({
                  file,
                  label: `Reference ${fileIndex + 1}`,
                })),
              ];
              return (
                <div key={`${design.name ?? 'design'}-${index}`} className="ead-design-block">
                  <div className="ead-dh">
                    <div>
                      <h3>{designOptionLabel(index, design.name)}</h3>
                      <p className="ead-he-sub" style={{ margin: '4px 0 0' }}>
                        {sizes.length === 1 ? '1 size requested' : `${sizes.length} sizes requested`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ead-btn"
                      disabled={all.length === 0}
                      onClick={() => void downloadAll(all)}
                    >
                      <i className="ti ti-download" /> Download all files
                    </button>
                  </div>
                  <div className="ead-b" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <div className="ead-kicker">Artwork & references</div>
                      {gallery.length === 0 && <div className="ead-he-sub">No artwork uploaded.</div>}
                      <div className="ead-files">
                        {gallery.map(({ file, label }) => (
                          <EmbroideryFileCard
                            key={file.id}
                            name={file.name}
                            mimeType={file.mimeType}
                            previewUrl={file.previewUrl}
                            signedUrlPath={adminAttachmentUrl(order.id, file.id)}
                            label={label}
                            onError={setError}
                          />
                        ))}
                      </div>
                    </div>
                    {vector ? (
                      <div>
                        <div className="ead-kicker">Artwork preferences</div>
                        <dl className="ead-prefs">
                          <div>
                            <dt>Background</dt>
                            <dd>{backgroundLabel(design.background)}</dd>
                          </div>
                          <div>
                            <dt>Color mode</dt>
                            <dd>{colorModeLabel(design.colors)}</dd>
                          </div>
                          <div>
                            <dt>Resolution</dt>
                            <dd>{resolutionLabel(design.dpi300)}</dd>
                          </div>
                        </dl>
                      </div>
                    ) : (
                      <div>
                        <table className={cutting ? 'ead-table ead-table-cut' : 'ead-table'}>
                          <thead>
                            <tr>
                              <th>Size</th>
                              {!cutting && <th>Placement</th>}
                              <th>Proportional</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sizes.length === 0 && (
                              <tr>
                                <td colSpan={cutting ? 2 : 3}>No sizes added.</td>
                              </tr>
                            )}
                            {sizes.map((size, sizeIndex) => (
                              <tr key={`${size.detail ?? 'size'}-${sizeIndex}`}>
                                <td>{sizeDetail(size)}</td>
                                {!cutting && <td>{size.placement || '—'}</td>}
                                <td>{size.keepProportional === false ? 'No' : 'Yes'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {design.notes?.trim() && (
                      <div className="ead-instruct">
                        <b>Customer instructions</b>
                        <p>{design.notes.trim()}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="ead-card">
            <div className="ead-card-h">
              <h2>Delivery preferences</h2>
            </div>
            <div className="ead-b">
              <dl className="ead-prefs">
                <div>
                  <dt>Requested formats</dt>
                  <dd>
                    {(prefs?.formats ?? []).length === 0 && 'None selected'}
                    {(prefs?.formats ?? []).map((fmt) => (
                      <span key={fmt} className="ead-chip">{fmt}</span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>Preview files</dt>
                  <dd>
                    {cutting ? (
                      <span className="ead-chip">Proof</span>
                    ) : (
                      <>
                        <span className="ead-chip">PDF</span>
                        <span className="ead-chip">PNG</span>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Turnaround</dt>
                  <dd>{turnaroundLabel(prefs?.turnaround)}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>

        <aside className="ead-rail">
          <section className="ead-card ead-quote-panel">
            <div className="ead-card-h">
              <span className="ead-ic"><i className="ti ti-currency-dollar" /></span>
              <h2>
                {approved ? 'Approved quote' : showBuilder ? 'Prepare quote' : 'Sent quote'}
              </h2>
              {(studio?.version ?? 0) > 0 && (isOrder || sentVersion > 0) && (
                <span className="ead-ver-pill">Version {studio?.version}</span>
              )}
            </div>
            <div className="ead-b">
              {awaitingCounter ? (
                <AdminCounterDecision
                  orderId={order.id}
                  customerAmount={latest?.amountCents ?? order.priceCents}
                  customerNote={latest?.comment}
                  studioAmount={studio?.amountCents}
                  canApprove={canApproveCounter}
                  approvePending={counterApprove.isPending}
                  onApprove={() => counterApprove.mutate()}
                  onDone={(next) => {
                    void applyOrderChange(qc, next);
                  }}
                  onError={setError}
                />
              ) : showBuilder ? (
                <>
                  {blocks.map((block) => (
                    <div key={block.key} className="ead-ql">
                      <label className="ead-ql-t">Design</label>
                      <div className="ead-ql-top">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <SelectMenu
                            size="ead"
                            ariaLabel="Design"
                            value={block.designKey}
                            onChange={(value) =>
                              setBlocks((prev) =>
                                prev.map((b) => (b.key === block.key ? { ...b, designKey: value } : b)),
                              )
                            }
                            options={[
                              { value: '', label: 'Select design' },
                              ...options.map((option) => ({ value: option, label: option })),
                            ]}
                          />
                        </div>
                        {blocks.length > 1 && (
                          <button
                            type="button"
                            className="ead-linkish"
                            onClick={() => setBlocks((prev) => prev.filter((b) => b.key !== block.key))}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {block.rows.map((row) => (
                        <div key={row.key} className="ead-art">
                          <div className="ead-ql-top">
                            <label className="ead-ql-t">Item name</label>
                            {block.rows.length > 1 && (
                              <button
                                type="button"
                                className="ead-linkish"
                                onClick={() =>
                                  setBlocks((prev) =>
                                    prev.map((b) =>
                                      b.key === block.key
                                        ? { ...b, rows: b.rows.filter((r) => r.key !== row.key) }
                                        : b,
                                    ),
                                  )
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <input
                            className="ead-field"
                            placeholder="e.g. Vector artwork"
                            aria-label="Item name"
                            value={row.description}
                            onChange={(e) =>
                              setBlocks((prev) =>
                                prev.map((b) =>
                                  b.key === block.key
                                    ? {
                                        ...b,
                                        rows: b.rows.map((r) =>
                                          r.key === row.key ? { ...r, description: e.target.value } : r,
                                        ),
                                      }
                                    : b,
                                ),
                              )
                            }
                          />
                          <label className="ead-ql-t" style={{ marginTop: 8 }}>Price (USD)</label>
                          <input
                            className="ead-field"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            aria-label="Price (USD)"
                            value={row.price}
                            onChange={(e) =>
                              setBlocks((prev) =>
                                prev.map((b) =>
                                  b.key === block.key
                                    ? {
                                        ...b,
                                        rows: b.rows.map((r) =>
                                          r.key === row.key ? { ...r, price: e.target.value } : r,
                                        ),
                                      }
                                    : b,
                                ),
                              )
                            }
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="ead-add line"
                        onClick={() =>
                          setBlocks((prev) =>
                            prev.map((b) => (b.key === block.key ? { ...b, rows: [...b.rows, emptyRow()] } : b)),
                          )
                        }
                      >
                        <i className="ti ti-plus" /> Add another item
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ead-add"
                    onClick={() =>
                      setBlocks((prev) => [
                        ...prev,
                        {
                          key: newKey(),
                          designKey: options[Math.min(prev.length, Math.max(options.length - 1, 0))] ?? '',
                          rows: [emptyRow()],
                        },
                      ])
                    }
                  >
                    <i className="ti ti-plus" /> Add another design
                  </button>
                  <div className="ead-total">
                    <span>Total</span>
                    <b>{money(totalCents)}</b>
                  </div>
                  <div className="ead-stack">
                    <button
                      type="button"
                      className="ead-btn pri blk"
                      disabled={sendQuote.isPending || declined}
                      onClick={() => sendQuote.mutate()}
                    >
                      {sendLabel}
                    </button>
                    <button type="button" className="ead-draft" onClick={saveDraft}>
                      {draftSaved ? 'Draft saved' : 'Save draft'}
                    </button>
                    {editing && (
                      <button type="button" className="ead-btn blk" onClick={() => setEditing(false)}>
                        Cancel edit
                      </button>
                    )}
                    {sentVersion > 0 && isStaffCreatedOrder(order) && (
                      <button
                        type="button"
                        className="ead-btn blk"
                        disabled={approveForCustomer.isPending}
                        onClick={() => {
                          void dialog
                            .confirm({
                              title: 'Approve for the customer?',
                              message:
                                'You created this quote, so you can accept it on their behalf. It becomes an order and they get an invoice to pay.',
                              confirmLabel: 'Approve quote',
                            })
                            .then((ok) => {
                              if (ok) approveForCustomer.mutate();
                            });
                        }}
                      >
                        <i className="ti ti-check" />{' '}
                        {approveForCustomer.isPending ? 'Approving…' : 'Approve for customer'}
                      </button>
                    )}
                    {sentVersion === 0 && (
                      <button
                        type="button"
                        className="ead-btn blk"
                        disabled={declineMut.isPending || declined}
                        onClick={() => {
                          void dialog
                            .confirm({
                              title: 'Decline this request?',
                              message: 'The customer will see this quote as declined.',
                              confirmLabel: 'Decline',
                              danger: true,
                            })
                            .then((ok) => {
                              if (ok) declineMut.mutate();
                            });
                        }}
                      >
                        <i className="ti ti-x" /> {declineMut.isPending ? 'Declining…' : 'Decline'}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="ead-sent">
                    <div className="ead-sent-row">
                      <span className="ead-ql-t">Design</span>
                      <strong title={project.full}>{project.text}</strong>
                    </div>
                    <div className="ead-kicker" style={{ marginTop: 14 }}>Quoted item</div>
                    {studioLines.length === 0 && <div className="ead-he-sub">No priced items.</div>}
                    {studioLines.map((line) => (
                      <div key={line.id} className="ead-sent-line">
                        <span>{line.name}</span>
                        <b>{money(lineTotal(line))}</b>
                      </div>
                    ))}
                    <div className={`ead-total${approved ? ' paid' : ''}`}>
                      <span>{approved ? 'Total paid' : 'Total'}</span>
                      <b>{money(quotedTotal)}</b>
                    </div>
                  </div>
                  <div className="ead-stack">
                    {!isOrder && !declined && (
                      <button type="button" className="ead-btn blk" onClick={startEdit}>
                        <i className="ti ti-pencil" /> Edit quote
                      </button>
                    )}
                    {approved && (
                      <Link className="ead-btn blk" to={orderTo}>
                        <i className="ti ti-file-invoice" /> View invoice
                      </Link>
                    )}
                    {sentVersion > 0 && isStaffCreatedOrder(order) && !isOrder && (
                      <button
                        type="button"
                        className="ead-btn blk"
                        disabled={approveForCustomer.isPending}
                        onClick={() => {
                          void dialog
                            .confirm({
                              title: 'Approve for the customer?',
                              message:
                                'You created this quote, so you can accept it on their behalf. It becomes an order and they get an invoice to pay.',
                              confirmLabel: 'Approve quote',
                            })
                            .then((ok) => {
                              if (ok) approveForCustomer.mutate();
                            });
                        }}
                      >
                        <i className="ti ti-check" />{' '}
                        {approveForCustomer.isPending ? 'Approving…' : 'Approve for customer'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="ead-card">
            <button
              type="button"
              className={notesOpen ? 'ead-notes-tog open' : 'ead-notes-tog'}
              onClick={() => setNotesOpen((open) => !open)}
            >
              <span className="ead-ic"><i className="ti ti-notes" /></span>
              <span className="ead-notes-copy">
                <strong>Internal Notes</strong>
                <small>Only your team</small>
              </span>
              <i className="ti ti-chevron-down" aria-hidden />
            </button>
            {notesOpen && (
              <div className="ead-b" style={{ paddingTop: 0 }}>
                <textarea
                  className="ead-field"
                  placeholder="Notes about this order..."
                  style={{ minHeight: 90, resize: 'vertical' }}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <button
                  type="button"
                  className="ead-btn"
                  style={{ marginTop: 10 }}
                  disabled={notesMut.isPending}
                  onClick={() => notesMut.mutate()}
                >
                  {notesSaved ? 'Saved ✓' : notesMut.isPending ? 'Saving…' : 'Save Notes'}
                </button>
              </div>
            )}
          </section>

          <section className="ead-card">
            <div className="ead-card-h">
              <span className="ead-ic"><i className="ti ti-clock" /></span>
              <h2>Quote History</h2>
              <span className="ead-sub">
                {history.length + 1} {history.length === 0 ? 'Entry' : 'Entries'}
              </span>
            </div>
            <div className="ead-b">
              <ul style={{ margin: 0, padding: 0 }}>
                <li className="ead-he">
                  <div className="ead-he-top">
                    <span className="ead-ver">Request</span>
                    {history.length === 0 && <span className="ead-chg mute">No Quote Yet</span>}
                  </div>
                  <div className="ead-he-sub">{dateStamp(order.createdAt)} · Customer</div>
                </li>
                {[...history].reverse().map((entry) => (
                  <li key={entry.quote.id} className="ead-he">
                    <div className="ead-he-top">
                      <span className="ead-ver">v{entry.quote.version}</span>
                      <b>{money(entry.quote.amountCents)}</b>
                      {entry.kind === 'first' && <span className="ead-chg mute">First Quote</span>}
                      {entry.kind === 'same' && <span className="ead-chg mute">No Change</span>}
                      {entry.kind === 'up' && (
                        <span className="ead-chg up">
                          +{money(entry.delta)} ({entry.pct.toFixed(1)}%)
                        </span>
                      )}
                      {entry.kind === 'down' && (
                        <span className="ead-chg down">
                          −{money(Math.abs(entry.delta))} ({Math.abs(entry.pct).toFixed(1)}%)
                        </span>
                      )}
                    </div>
                    <div className="ead-he-sub">{dateStamp(entry.quote.createdAt)} · Admin</div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="ead-card">
            <div className="ead-card-h">
              <span className="ead-ic"><i className="ti ti-user" /></span>
              <h2>Customer Details</h2>
            </div>
            <div className="ead-b">
              <dl className="ead-cust">
                <div>
                  <dt>Name</dt>
                  <dd>{customer?.name || clientName || 'Customer'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{customer?.email || order.client?.email || '—'}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{customer?.phone || '—'}</dd>
                </div>
                {company && (
                  <div>
                    <dt>Company</dt>
                    <dd>{company}</dd>
                  </div>
                )}
              </dl>
              <button
                type="button"
                className={ordersOpen ? 'ead-toggle open' : 'ead-toggle'}
                onClick={() => setOrdersOpen((open) => !open)}
              >
                <span>
                  {ordersOpen ? `Hide Past Orders (${shownPastCount})` : `View Past Orders (${shownPastCount})`}
                </span>
                <i className="ti ti-chevron-down" />
              </button>
              <div className={ordersOpen ? 'ead-orders open' : 'ead-orders'}>
                {pastOrders.slice(0, 3).map((past) => (
                  <Link key={past.id} to={`/admin/orders/${orderSlug(past.humanRef, past.id)}`} className="ead-oc">
                    <div className="ead-ot">
                      <span>Order {orderNumber(past.humanRef, past.id.slice(0, 8))}</span>
                      <span className="ead-st">{orderStatusLabel(past.status)}</span>
                    </div>
                    <div className="ead-oi">
                      <span className="ead-th" aria-hidden>
                        <i className="ti ti-package" />
                      </span>
                      <div>
                        <p>{past.name || 'Order'}</p>
                        <small>
                          {money(past.priceCents)}
                          {(past.quantity ?? 0) > 0 ? ` · Quantity: ${past.quantity}` : ''}
                        </small>
                      </div>
                    </div>
                  </Link>
                ))}
                {pastOrders.length === 0 && <div className="ead-he-sub">No other orders yet.</div>}
                {shownPastCount > 3 && (
                  <Link to="/admin/orders" className="ead-all">
                    View All {shownPastCount} Orders →
                  </Link>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
