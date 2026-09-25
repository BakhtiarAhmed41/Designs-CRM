import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AdminCounterDecision } from '@/components/AdminCounterDecision';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { useDialog } from '@/components/ui/AppDialog';
import { useAuth } from '@/context/AuthContext';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import type { CustomerDetail } from '@/lib/customers';
import { submitQuoteBuilder } from '@/lib/designs';
import { money, orderNumber, orderSlug } from '@/lib/format';
import {
  asEmbroideryPrefs,
  backgroundLabel,
  colorModeLabel,
  colorSelectedLabel,
  cuttingServiceLabel,
  designCountLabel,
  designNote,
  designOptionLabel,
  embroideryDesigns,
  filesForDesign,
  parseDesignNote,
  resolutionLabel,
  sizeDetail,
  turnaroundLabel,
  unitLabel,
  vectorServiceLabel,
  type EmbAttachment,
} from '@/lib/embroideryQuote';
import { createAdminConversation, listAdminConversations } from '@/lib/messaging';
import {
  adminAttachmentUrl,
  adminRejectOrder,
  approveCounter,
  deleteAdminOrder,
  updateOrderNotes,
} from '@/lib/orders';
import { applyOrderChange, invalidateWorkCaches } from '@/lib/queryCache';
import { canSupport } from '@/lib/permissions';
import { studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import type { Order } from '@/lib/types';
import '@/styles/embroidery-quote.css';

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
    return [{ key: newKey(), designKey: options[0] ?? '', rows: [emptyRow()] }];
  }
  const blocks: DesignBlock[] = [];
  for (const line of lines) {
    const designKey = parseDesignNote(line.note) ?? options[0] ?? '';
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
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    setNotes(order.internalNotes ?? '');
  }, [order.internalNotes, order.id]);

  useEffect(() => {
    setBlocks(blocksFromQuote(studio, options));
    // Refill when a newly sent quote comes back on this order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio?.id]);

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

  const pill =
    sentVersion > 0
      ? { text: `Quote Sent · v${sentVersion}`, ok: true }
      : declined
        ? { text: 'Declined', ok: false }
        : awaitingCounter
          ? { text: 'Counter to review', ok: false }
          : { text: 'Needs Your Price', ok: false };

  return (
    <div className="ead">
      <div className="ead-head">
        <div>
          <h1>Embroidery Quote Request</h1>
          <p className="ead-meta">
            <span className={pill.ok ? 'ead-pill ok' : 'ead-pill'}>{pill.text}</span>
            <span>{dateStamp(order.createdAt)}</span>
          </p>
        </div>
        <div className="ead-acts">
          <button type="button" className="ead-btn pri" disabled={messaging} onClick={() => void messageCustomer()}>
            <i className="ti ti-message" /> {messaging ? 'Opening…' : 'Message Us'}
          </button>
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
        </div>
      </div>

      {error && <div className="ead-banner">{error}</div>}

      <dl className="ead-spec">
        <div>
          <dt>{vector ? 'Services Requested' : 'Service Requested'}</dt>
          <dd>
            {vector
              ? vectorServiceLabel(designs)
              : cutting
                ? cuttingServiceLabel(designs)
                : 'Embroidery Digitizing'}
          </dd>
        </div>
        <div>
          <dt>Designs</dt>
          <dd>{designCountLabel(designs.length)}</dd>
        </div>
        <div>
          <dt>{vector ? 'Color Selected' : 'Measurement Unit'}</dt>
          <dd>{vector ? colorSelectedLabel(designs) : unitLabel(prefs?.unit)}</dd>
        </div>
      </dl>

      <div className="ead-grid">
        <div className="ead-col">
          <section className="ead-card">
            {designs.map((design, index) => {
              const files = designFiles[index] ?? { artwork: [], references: [] };
              const all = [...files.artwork, ...files.references];
              const sizes = (design.sizes ?? []).filter((s) => s.detail || s.placement || s.w || s.h);
              return (
                <div key={`${design.name ?? 'design'}-${index}`}>
                  <div className="ead-dh" style={index > 0 ? { borderTop: '1px solid #e4e5e8' } : undefined}>
                    <h3>
                      Design {index + 1} - {design.name?.trim() || 'Untitled design'}
                    </h3>
                    <button
                      type="button"
                      className="ead-btn"
                      disabled={all.length === 0}
                      onClick={() => void downloadAll(all)}
                    >
                      <i className="ti ti-download" /> Download All Files
                    </button>
                  </div>
                  <div className="ead-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div className="ead-kicker">Artworks</div>
                      {files.artwork.length === 0 && <div className="ead-he-sub">No artwork uploaded.</div>}
                      <div className="ead-files">
                        {files.artwork.map((file, fileIndex) => (
                          <EmbroideryFileCard
                            key={file.id}
                            name={file.name}
                            mimeType={file.mimeType}
                            previewUrl={file.previewUrl}
                            signedUrlPath={adminAttachmentUrl(order.id, file.id)}
                            label={cutting || vector || fileIndex === 0 ? 'Main Artwork' : 'Alternate Artwork'}
                            onError={setError}
                          />
                        ))}
                      </div>
                    </div>
                    {files.references.length > 0 && (
                      <div>
                        <div className="ead-kicker">Reference Images ({files.references.length})</div>
                        <div className="ead-files">
                          {files.references.map((file) => (
                            <EmbroideryFileCard
                              key={file.id}
                              name={file.name}
                              mimeType={file.mimeType}
                              previewUrl={file.previewUrl}
                              signedUrlPath={adminAttachmentUrl(order.id, file.id)}
                              label="Reference Image"
                              onError={setError}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {vector ? (
                      <div>
                        <div className="ead-kicker">Artwork Preferences</div>
                        <dl className="ead-prefs">
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
                      </div>
                    ) : (
                    <div>
                      <div className="ead-kicker">Requested Sizes and Placements ({sizes.length})</div>
                      <table className={cutting ? 'ead-table ead-table-cut' : 'ead-table'}>
                        <thead>
                        <tr>
                          <th>Size or Placement</th>
                          {!cutting && <th><span>Embroidered on</span></th>}
                          <th><span>Proportional</span></th>
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
                              {!cutting && <td><span>{size.placement || '—'}</span></td>}
                              <td>
                                {size.keepProportional === false ? (
                                  <span>No</span>
                                ) : (
                                  <span className="ead-yes">
                                    <i className="ti ti-check" /> Yes
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </div>
                  {design.notes?.trim() && (
                    <div className="ead-note">
                      <b>{vector ? "Customer's Project Notes" : "Customer's Design Instructions"}</b>
                      <span>{design.notes.trim()}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section className="ead-card">
            <div className="ead-card-h">
              <span className="ead-ic"><i className="ti ti-package" /></span>
              <h2>Delivery Preferences</h2>
            </div>
            <div className="ead-b">
              <dl className="ead-prefs">
                <div>
                  <dt>Requested File Formats</dt>
                  <dd>
                    {(prefs?.formats ?? []).length === 0 && 'None selected'}
                    {(prefs?.formats ?? []).map((fmt) => (
                      <span key={fmt} className="ead-chip">{fmt}</span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>Preview Files Included</dt>
                  <dd>{cutting ? 'Proof Preview' : 'PDF and PNG'}</dd>
                </div>
                <div>
                  <dt>Turnaround Requested</dt>
                  <dd>{turnaroundLabel(prefs?.turnaround)}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>

        <aside className="ead-rail">
          <section className="ead-card">
            <div className="ead-card-h">
              <span className="ead-ic"><i className="ti ti-currency-dollar" /></span>
              <h2>Generate Quote</h2>
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
              ) : (
                <>
                  <div className="ead-kicker">Quote Designs</div>
                  {blocks.map((block) => (
                    <div key={block.key} className="ead-ql">
                      <div className="ead-ql-top">
                        <span className="ead-ql-t">Select Design</span>
                        <button
                          type="button"
                          className="ead-linkish"
                          style={{ visibility: blocks.length > 1 ? 'visible' : 'hidden' }}
                          onClick={() => setBlocks((prev) => prev.filter((b) => b.key !== block.key))}
                        >
                          Remove
                        </button>
                      </div>
                      <select
                        className="ead-select"
                        aria-label="Select Design"
                        value={block.designKey}
                        onChange={(e) =>
                          setBlocks((prev) =>
                            prev.map((b) => (b.key === block.key ? { ...b, designKey: e.target.value } : b)),
                          )
                        }
                      >
                        <option value="">Select Design</option>
                        {options.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      {block.rows.map((row) => (
                        <div key={row.key} className="ead-art">
                          <div className="ead-ql-top">
                            <span className="ead-ql-t">Artworks</span>
                            <button
                              type="button"
                              className="ead-linkish"
                              style={{ visibility: block.rows.length > 1 ? 'visible' : 'hidden' }}
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
                          </div>
                          <input
                            className="ead-field"
                            placeholder="Describe this item"
                            aria-label="Item description"
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
                          <input
                            className="ead-field"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Price"
                            aria-label="Price"
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
                        <i className="ti ti-plus" /> Add Price
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
                    <i className="ti ti-plus" /> Add Another Design
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
                      <i className="ti ti-send" />
                      {sendQuote.isPending ? 'Sending…' : 'Send Quote for Per-Design Approval'}
                    </button>
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
                      <i className="ti ti-x" /> {declineMut.isPending ? 'Declining…' : 'Decline This Request'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="ead-card">
            <div className="ead-card-h">
              <span className="ead-ic"><i className="ti ti-notes" /></span>
              <h2>Internal Notes</h2>
              <span className="ead-sub">Only your team</span>
            </div>
            <div className="ead-b">
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
