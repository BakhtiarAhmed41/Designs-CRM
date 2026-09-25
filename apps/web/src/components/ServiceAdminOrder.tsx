import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { useTopbarLead } from '@/components/Shell';
import { useDialog } from '@/components/ui/AppDialog';
import { ErrorBanner } from '@/components/ui/EmptyState';
import { apiFetch, downloadSignedFile, getErrorMessage, resolveFileUrl } from '@/lib/api';
import { refundOrder } from '@/lib/billing';
import type { RefundTo } from '@/lib/billing';
import { createDesign, updateDesign, type Design, type DesignStatus } from '@/lib/designs';
import { createAdminEdit, getOrderActivity, listAdminOrderEdits, type EditKind } from '@/lib/edits';
import {
  asEmbroideryPrefs,
  backgroundLabel,
  colorModeLabel,
  designOptionLabel,
  embroideryDesigns,
  filesForDesign,
  resolutionLabel,
  serviceOrderKind,
  serviceRequestedLabel,
  sizeDetail,
  turnaroundLabel,
  type EmbAttachment,
} from '@/lib/embroideryQuote';
import { dateShort, money, orderNumber } from '@/lib/format';
import { createAdminConversation } from '@/lib/messaging';
import {
  adminAttachmentUrl,
  adminDeliveryFileUrl,
  deleteAdminOrder,
  deliverOrder,
  updateOrderNotes,
} from '@/lib/orders';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { quoteHistoryLabel, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import { deliveryCounts, orderDeliveryGroups, type DeliveryRow } from '@/lib/serviceOrderView';
import { assignOrder, listTeam, unassignOrder } from '@/lib/team';
import type { Order } from '@/lib/types';
import '@/styles/embroidery-quote.css';

type AdminOrder = Order & {
  designs?: Design[];
  internalNotes?: string | null;
  assignedDesignerId?: string | null;
};

function personName(member: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email;
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function linePhase(status?: DesignStatus | string) {
  if (status === 'DELIVERED') return 'delivered';
  if (status === 'DONE') return 'ready';
  return 'progress';
}

function activityLabel(event: string, meta: { note?: string; source?: string }) {
  if (event === 'edit_requested') {
    return meta.source === 'client' ? 'Customer asked for a revision' : 'Revision started';
  }
  if (event === 'edit_done') return 'Revision marked done';
  return event.replace(/_/g, ' ');
}

export function ServiceAdminOrder({ order }: { order: AdminOrder }) {
  const kind = serviceOrderKind(order) ?? 'embroidery';
  const cutting = kind === 'cutting';
  const vector = kind === 'vector';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dialog = useDialog();
  const prefs = asEmbroideryPrefs(order.preferences);
  const requestDesigns = embroideryDesigns(order.preferences, order.name);
  const quotations = (order.quotations ?? []) as QuoteWithLines[];
  const studio = studioQuotation(quotations);
  const lines = studio?.lines ?? [];
  const groups = orderDeliveryGroups(order, lines);
  const counts = deliveryCounts(groups);
  const accepted = lines.filter((line) => line.clientDecision !== 'DROPPED').length || counts.total;
  const quoted = lines.length || counts.total;
  const paid = order.paymentStatus === 'PAID';
  const amountPaid = paid ? order.priceCents : 0;
  const quoteNo = orderNumber(order.humanRef, order.id.slice(0, 6));
  const attachments: EmbAttachment[] = (order.attachments ?? []).map((file) => ({
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    previewUrl: file.previewUrl,
  }));
  const claimed = new Set<string>();
  const designFiles = requestDesigns.map((design) => filesForDesign(design, attachments, claimed));
  const history = [...quotations].sort((a, b) => a.version - b.version);

  const [notes, setNotes] = useState(order.internalNotes ?? '');
  const [designerId, setDesignerId] = useState(order.assignedDesignerId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<DeliveryRow | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [filesFor, setFilesFor] = useState<DeliveryRow | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [revisionKind, setRevisionKind] = useState<EditKind>('FREE');
  const [revisionPrice, setRevisionPrice] = useState('');
  const [assignRevision, setAssignRevision] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState(((order.priceCents ?? 0) / 100).toFixed(2));
  const [refundTo, setRefundTo] = useState<RefundTo>('STORE_CREDIT');
  const [refundReason, setRefundReason] = useState('');

  useEffect(() => setNotes(order.internalNotes ?? ''), [order.internalNotes]);
  useEffect(() => setDesignerId(order.assignedDesignerId ?? ''), [order.assignedDesignerId]);

  const topbarLead = useMemo(
    () => (
      <nav className="ecd-crumb" aria-label="Breadcrumb">
        <Link to="/admin/orders">Orders</Link>
        <span aria-hidden="true">/</span>
        <b>{quoteNo}</b>
      </nav>
    ),
    [quoteNo],
  );
  useTopbarLead(topbarLead);

  const teamQ = useQuery({ queryKey: ['admin-team'], queryFn: listTeam });
  const activityQ = useQuery({
    queryKey: ['order-activity', order.id],
    queryFn: () => getOrderActivity(order.id),
  });
  const editsQ = useQuery({
    queryKey: ['admin-order-edits', order.id],
    queryFn: () => listAdminOrderEdits(order.id),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-order', order.id] });
    void qc.invalidateQueries({ queryKey: ['order-activity', order.id] });
    void qc.invalidateQueries({ queryKey: ['admin-order-edits', order.id] });
    void invalidateWorkCaches(qc);
  };

  const designers = (teamQ.data?.members ?? []).filter((member) => member.role === 'DESIGNER');
  const designerOptions = designers.length
    ? designers
    : (teamQ.data?.members ?? []).filter((member) => member.role !== 'CLIENT');

  async function ensureDesign(row: DeliveryRow) {
    if (row.design) return row.design.id;
    const created = await createDesign(order.id, {
      name: row.name,
      priceCents: row.priceCents,
    });
    return created.design.id;
  }

  const markReady = useMutation({
    mutationFn: async (row: DeliveryRow) => {
      const designId = await ensureDesign(row);
      await updateDesign(order.id, designId, { status: 'DONE' });
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const publish = useMutation({
    mutationFn: async ({ row, files }: { row: DeliveryRow; files: File[] }) => {
      const designId = await ensureDesign(row);
      return deliverOrder(order.id, files, {
        designIds: [designId],
        deliveredVia: 'PORTAL',
        notifyEmail: true,
        release: true,
        kind: 'FINAL',
      });
    },
    onSuccess: () => {
      setUploadFor(null);
      setPendingFiles([]);
      setError(null);
      refresh();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const assign = useMutation({
    mutationFn: () =>
      designerId ? assignOrder(designerId, order.id) : unassignOrder(order.id),
    onSuccess: () => refresh(),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const saveNotes = useMutation({
    mutationFn: () => updateOrderNotes(order.id, notes),
    onSuccess: () => refresh(),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteAdminOrder(order.id),
    onSuccess: () => navigate('/admin/orders'),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const message = useMutation({
    mutationFn: (help: boolean) =>
      createAdminConversation({
        customerId: order.customerId,
        orderId: order.id,
        chatType: 'ORDER',
        label: help ? 'HELP' : undefined,
        subject: `Order ${quoteNo} Chat`,
      }),
    onSuccess: (res) => navigate(`/admin/messages/customers/${res.conversation.id}`),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const revision = useMutation({
    mutationFn: () => {
      const dollars = Number(revisionPrice);
      const priceCents =
        revisionKind === 'PAID' && Number.isFinite(dollars)
          ? Math.round(dollars * 100)
          : null;
      return createAdminEdit(order.id, {
        note: revisionNote.trim(),
        kind: revisionKind,
        priceCents,
        assignedDesignerId: assignRevision ? designerId || order.assignedDesignerId : null,
      });
    },
    onSuccess: async () => {
      setRevisionOpen(false);
      setRevisionNote('');
      setRevisionPrice('');
      setRevisionKind('FREE');
      setAssignRevision(false);
      refresh();
      await dialog.alert({
        title: 'Revision created',
        message: 'The order stays open. The customer keeps the current files until you publish the new ones.',
        confirmLabel: 'Done',
        tone: 'success',
      });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const refund = useMutation({
    mutationFn: () => {
      const cents = Math.round(Number(refundAmount) * 100);
      return refundOrder(order.id, {
        amountCents: cents,
        to: refundTo,
        reason: refundReason.trim() || undefined,
      });
    },
    onSuccess: () => {
      setRefundOpen(false);
      refresh();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const deliveredFiles = (row: DeliveryRow) =>
    (order.deliveries ?? []).flatMap((batch) =>
      batch.files.filter((file) => file.designId && file.designId === row.design?.id),
    );

  async function previewFile(fileId: string) {
    const { url } = await apiFetch<{ url: string }>(adminDeliveryFileUrl(order.id, fileId));
    window.open(resolveFileUrl(url), '_blank', 'noopener');
  }

  return (
    <div className="ead">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="ead-head">
        <div>
          <h1>{order.name?.trim() || 'Order'}</h1>
          <div className="ead-meta">
            <span className={counts.allDelivered ? 'ead-pill ok' : 'ead-pill'}>
              {counts.allDelivered ? 'Delivered' : 'In process'}
            </span>
            <span>Placed {dateShort(order.createdAt)}</span>
          </div>
        </div>
        <div className="ead-acts">
          {!counts.allDelivered && (
            <button
              type="button"
              className="ead-btn pri"
              disabled={message.isPending || !order.customerId}
              onClick={() => message.mutate(false)}
            >
              <i className="ti ti-message" /> Message customer
            </button>
          )}
          {counts.allDelivered && (
            <button
              type="button"
              className="ead-btn pri"
              disabled={message.isPending || !order.customerId}
              onClick={() => message.mutate(true)}
            >
              <i className="ti ti-message" /> Help Request
            </button>
          )}
          <button type="button" className="ead-btn" onClick={() => setRevisionOpen(true)}>
            <i className="ti ti-pencil" /> Create revision
          </button>
          <button
            type="button"
            className="ead-btn icon"
            title="Delete"
            disabled={remove.isPending}
            onClick={() => {
              void dialog
                .confirm({
                  title: `Delete ${quoteNo}?`,
                  message: 'This removes the order and its files.',
                  confirmLabel: 'Delete',
                  danger: true,
                })
                .then((ok) => {
                  if (ok) remove.mutate();
                });
            }}
          >
            <i className="ti ti-trash" />
          </button>
        </div>
      </div>

      <dl className="ead-spec">
        <div>
          <dt>Service requested</dt>
          <dd>{serviceRequestedLabel(kind, requestDesigns)}</dd>
        </div>
        <div>
          <dt>Approved items</dt>
          <dd>
            {accepted} of {quoted} accepted
          </dd>
        </div>
        <div>
          <dt>Amount paid</dt>
          <dd>{money(amountPaid, order.currency)}</dd>
        </div>
      </dl>

      <div className="ead-grid">
        <div className="ead-col">
          <section className="ead-card">
            <div className="ead-card-h">
              <h2>Order delivery</h2>
              <span className="ead-sub">
                {counts.delivered} of {counts.total} items approved
              </span>
            </div>
            <div className="ead-b">
              {groups.length === 0 && <div className="ead-he-sub">No priced items on this order yet.</div>}
              {groups.map((group, groupIndex) => (
                <div key={group.title} className="sod-group" style={groupIndex === 0 ? { marginTop: 0 } : undefined}>
                  <h3>{group.title}</h3>
                  {group.rows.map((row) => {
                    const phase = linePhase(row.design?.status);
                    return (
                      <div key={row.key} className="sod-line">
                        <b>{row.name}</b>
                        <div className="sod-acts">
                          {phase === 'progress' && (
                            <>
                              <span className="sod-status">In progress</span>
                              <button
                                type="button"
                                className="ead-btn sm"
                                disabled={markReady.isPending}
                                onClick={() => markReady.mutate(row)}
                              >
                                Mark ready
                              </button>
                              <button
                                type="button"
                                className="ead-btn sm pri"
                                onClick={() => {
                                  setUploadFor(row);
                                  setPendingFiles([]);
                                }}
                              >
                                Attach & publish
                              </button>
                            </>
                          )}
                          {phase === 'ready' && (
                            <>
                              <span className="sod-status ready">Ready</span>
                              <button
                                type="button"
                                className="ead-btn sm pri"
                                onClick={() => {
                                  setUploadFor(row);
                                  setPendingFiles([]);
                                }}
                              >
                                Attach & publish
                              </button>
                            </>
                          )}
                          {phase === 'delivered' && (
                            <>
                              <span className="sod-status ready">Delivered</span>
                              <button
                                type="button"
                                className="sod-eye"
                                title="View delivered files"
                                onClick={() => setFilesFor(row)}
                              >
                                <i className="ti ti-eye" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          {(editsQ.data?.edits.length ?? 0) > 0 && (
            <section className="ead-card">
              <div className="ead-card-h">
                <span className="ead-ic"><i className="ti ti-refresh" /></span>
                <h2>Customer revision</h2>
              </div>
              <div className="ead-b">
                {editsQ.data?.edits.map((edit) => (
                  <div key={edit.id} className="ead-he">
                    <div className="ead-he-top">
                      <span>{edit.kind === 'PAID' ? 'Paid revision' : 'Free revision'}</span>
                      <b>{edit.kind === 'PAID' ? money(edit.priceCents, order.currency) : 'No charge'}</b>
                      <span className="ead-he-sub" style={{ marginTop: 0 }}>
                        {edit.status === 'DONE' ? 'Done' : 'Open'}
                      </span>
                    </div>
                    <div className="ead-he-sub">{edit.note}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="ead-card">
            <div className="ead-card-h">
              <h2>Order details</h2>
            </div>
            <div className="ead-b" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {requestDesigns.map((design, index) => {
                const files = designFiles[index] ?? { artwork: [], references: [] };
                const sizes = (design.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
                const label = designOptionLabel(index, design.name).replace(' - ', ' · ');
                const priced = groups.find((group) => group.title === label)?.rows ?? [];
                return (
                  <div key={`${design.name ?? 'design'}-${index}`}>
                    <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{label}</h3>
                    {priced.map((row) => (
                      <div key={row.key} className="sod-price">
                        <b>{row.name}</b>
                        <em>{money(row.priceCents, order.currency)}</em>
                      </div>
                    ))}
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
                    {files.references.length > 0 && (
                      <>
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
                      </>
                    )}
                    {vector ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <div className="ead-kicker">Requested Sizes and Placements ({sizes.length})</div>
                        <table className={cutting ? 'ead-table ead-table-cut' : 'ead-table'}>
                          <thead>
                            <tr>
                              <th>Size or Placement</th>
                              {!cutting && <th>Embroidered on</th>}
                              <th>Proportional</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sizes.map((size, sizeIndex) => (
                              <tr key={`${size.detail ?? 'size'}-${sizeIndex}`}>
                                <td>{sizeDetail(size)}</td>
                                {!cutting && (
                                  <td>
                                    <span>{size.placement || '—'}</span>
                                  </td>
                                )}
                                <td>
                                  <span>
                                    {size.keepProportional === false ? (
                                      'No'
                                    ) : (
                                      <>
                                        <i className="ti ti-check" /> Yes
                                      </>
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
                      </>
                    )}
                    {design.notes?.trim() && (
                      <div className="ead-note">
                        <b>{vector ? "Customer's Project Notes" : "Customer's Design Instructions"}</b>
                        <span>{design.notes.trim()}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
                  <dd>{cutting ? 'Proof Preview' : 'PDF and PNG'}</dd>
                </div>
                <div>
                  <dt>Turnaround</dt>
                  <dd>{turnaroundLabel(prefs?.turnaround).replace('Hours', 'hrs')}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="ead-card">
            <div className="ead-card-h">
              <h2>Quote history</h2>
              <span className="ead-sub">
                {history.length} {history.length === 1 ? 'version' : 'versions'} · {accepted}/{quoted} items accepted
              </span>
            </div>
            <div className="ead-b">
              {history.length === 0 && <div className="ead-he-sub">No quote has been sent yet.</div>}
              {history.map((quote) => {
                const acceptedPaid = quote.status === 'APPROVED' && paid;
                return (
                  <div key={quote.id} className="ead-he">
                    <div className="ead-he-top">
                      <span>{quoteHistoryLabel(quote, history)}</span>
                      <b>{money(quote.amountCents, quote.currency)}</b>
                      <span className="ead-he-sub" style={{ marginTop: 0 }}>
                        {acceptedPaid ? 'Accepted & paid' : quote.status === 'APPROVED' ? 'Accepted' : quote.status === 'SENT' ? 'Sent' : quote.status}
                      </span>
                    </div>
                    <div className="ead-he-sub">
                      {dateShort(quote.createdAt)}
                      {quote.comment ? ` · ${quote.comment}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="ead-rail">
          <section className="ead-card">
            <div className="ead-card-h"><h2>Designer</h2></div>
            <div className="ead-b">
              <select className="ead-select" value={designerId} onChange={(e) => setDesignerId(e.target.value)}>
                <option value="">Unassigned</option>
                {designerOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {personName(member)}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="ead-btn sm pri"
                  style={{ flex: 1 }}
                  disabled={assign.isPending || !designerId}
                  onClick={() => assign.mutate()}
                >
                  Assign
                </button>
                <button
                  type="button"
                  className="ead-btn sm"
                  style={{ flex: 1 }}
                  disabled={assign.isPending || !order.assignedDesignerId}
                  onClick={() => {
                    setDesignerId('');
                    unassignOrder(order.id).then(() => refresh()).catch((e) => setError(getErrorMessage(e)));
                  }}
                >
                  Unassigned
                </button>
              </div>
            </div>
          </section>

          <section className="ead-card">
            <div className="ead-card-h"><h2>Price & payment</h2></div>
            <div className="ead-b">
              <div className="sod-price">
                <span>Price</span>
                <b>{money(order.priceCents, order.currency)}</b>
              </div>
              <div className="sod-price">
                <span>Payment</span>
                <span className={paid ? 'ead-pill ok' : 'ead-pill'}>
                  {order.paymentStatus === 'REFUNDED' ? 'Refunded' : paid ? 'Paid in full' : 'Unpaid'}
                </span>
              </div>
              <button
                type="button"
                className="ead-btn"
                style={{ width: '100%', marginTop: 8 }}
                disabled={!paid}
                onClick={() => {
                  setRefundAmount(((order.priceCents ?? 0) / 100).toFixed(2));
                  setRefundOpen(true);
                }}
              >
                Refund
              </button>
            </div>
          </section>

          <section className="ead-card">
            <div className="ead-card-h">
              <h2>Internal notes</h2>
              <span className="ead-sub">Only your team</span>
            </div>
            <div className="ead-b">
              <textarea
                className="ead-field"
                placeholder="Notes about this order…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button
                type="button"
                className="ead-btn sm"
                style={{ marginTop: 8 }}
                disabled={saveNotes.isPending || notes === (order.internalNotes ?? '')}
                onClick={() => saveNotes.mutate()}
              >
                {saveNotes.isPending ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </section>

          <section className="ead-card">
            <div className="ead-card-h"><h2>Activity</h2></div>
            <div className="ead-b">
              {(activityQ.data?.activity.length ?? 0) === 0 && (
                <div className="ead-he-sub">No activity yet.</div>
              )}
              {activityQ.data?.activity.map((entry) => {
                const meta =
                  entry.meta && typeof entry.meta === 'object'
                    ? (entry.meta as { note?: string; source?: string })
                    : {};
                return (
                  <div key={entry.id} className="sod-act">
                    <span />
                    <div>
                      <div>{activityLabel(entry.event, meta)}</div>
                      {meta.note ? <div>{meta.note}</div> : null}
                      <small>
                        {[entry.actorName, when(entry.createdAt)].filter(Boolean).join(' · ')}
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      {uploadFor && (
        <div className="sod-ov" role="presentation" onClick={() => setUploadFor(null)}>
          <div className="sod-mo" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3>Upload design</h3>
              <button type="button" onClick={() => setUploadFor(null)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <p>
              Attach up to 10 files in any format, then publish the final files to mark this item delivered.
              <br />
              <b>Customer usually needs: </b>
              {(prefs?.formats ?? []).join(', ') || 'the requested formats'}
            </p>
            <button type="button" className="sod-drop" onClick={() => document.getElementById('sod-files')?.click()}>
              <i className="ti ti-upload" /> Choose files
            </button>
            <input
              id="sod-files"
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const next = [...pendingFiles, ...Array.from(e.target.files ?? [])].slice(0, 10);
                setPendingFiles(next);
                e.target.value = '';
              }}
            />
            <div className="sod-flist">
              {pendingFiles.map((file) => (
                <div key={`${file.name}-${file.size}`}>{file.name}</div>
              ))}
            </div>
            <div className="ead-he-sub">{pendingFiles.length} of 10 files attached</div>
            <div className="sod-mo-f">
              <button type="button" className="ead-btn" onClick={() => setUploadFor(null)}>Cancel</button>
              <button
                type="button"
                className="ead-btn pri"
                disabled={publish.isPending || pendingFiles.length === 0}
                onClick={() => publish.mutate({ row: uploadFor, files: pendingFiles })}
              >
                {publish.isPending ? 'Publishing…' : 'Publish files'}
              </button>
            </div>
          </div>
        </div>
      )}

      {filesFor && (
        <div className="sod-ov" role="presentation" onClick={() => setFilesFor(null)}>
          <div className="sod-mo" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3>Delivered files</h3>
              <button type="button" onClick={() => setFilesFor(null)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <p>Preview or download any of the delivered files below.</p>
            <div className="sod-flist">
              {deliveredFiles(filesFor).length === 0 && <div>No files published for this item yet.</div>}
              {deliveredFiles(filesFor).map((file) => (
                <div key={file.id} className="sod-file">
                  <span>{file.originalName}</span>
                  <span>
                    <button type="button" onClick={() => void previewFile(file.id)}>Preview</button>
                    <button
                      type="button"
                      onClick={() => void downloadSignedFile(adminDeliveryFileUrl(order.id, file.id), file.originalName)}
                    >
                      Download
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="sod-mo-f">
              <button type="button" className="ead-btn" onClick={() => setFilesFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {revisionOpen && (
        <div className="sod-ov" role="presentation" onClick={() => setRevisionOpen(false)}>
          <div className="sod-mo" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3>Create revision {quoteNo}</h3>
              <button type="button" onClick={() => setRevisionOpen(false)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <div className="sod-info">
              Stays on this order. The customer keeps the old files until you publish new ones.
            </div>
            <div className="sod-label">What needs to change</div>
            <textarea
              className="ead-field"
              value={revisionNote}
              placeholder='e.g. resize eagle to 3", make text bolder for stitching'
              onChange={(e) => setRevisionNote(e.target.value)}
            />
            <div className="sod-seg">
              <button
                type="button"
                className={revisionKind === 'FREE' ? 'ead-btn pri' : 'ead-btn'}
                onClick={() => setRevisionKind('FREE')}
              >
                Free revision
              </button>
              <button
                type="button"
                className={revisionKind === 'PAID' ? 'ead-btn pri' : 'ead-btn'}
                onClick={() => setRevisionKind('PAID')}
              >
                Paid revision
              </button>
            </div>
            {revisionKind === 'PAID' && (
              <>
                <div className="sod-label">Revision price. Payment link goes out first.</div>
                <input
                  className="ead-field"
                  type="number"
                  min="0"
                  step="0.01"
                  value={revisionPrice}
                  placeholder="5"
                  onChange={(e) => setRevisionPrice(e.target.value)}
                />
              </>
            )}
            <label className="sod-check">
              <input
                type="checkbox"
                checked={assignRevision}
                onChange={(e) => setAssignRevision(e.target.checked)}
              />
              Assign to designer
            </label>
            <button
              type="button"
              className="ead-btn pri"
              style={{ width: '100%' }}
              disabled={revision.isPending || !revisionNote.trim()}
              onClick={() => revision.mutate()}
            >
              <i className="ti ti-refresh" /> {revision.isPending ? 'Creating…' : 'Create revision'}
            </button>
          </div>
        </div>
      )}

      {refundOpen && (
        <div className="sod-ov" role="presentation" onClick={() => setRefundOpen(false)}>
          <div className="sod-mo" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3>Refund {quoteNo}</h3>
              <button type="button" onClick={() => setRefundOpen(false)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <div className="sod-label">Amount</div>
            <input className="ead-field" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
            <div className="sod-label">Refund to</div>
            <select className="ead-select" value={refundTo} onChange={(e) => setRefundTo(e.target.value as RefundTo)}>
              <option value="STORE_CREDIT">Store credit</option>
              <option value="CARD">Original payment method</option>
            </select>
            <div className="sod-label">Reason</div>
            <input
              className="ead-field"
              value={refundReason}
              placeholder="e.g. cancelled before work started"
              onChange={(e) => setRefundReason(e.target.value)}
            />
            <button
              type="button"
              className="ead-btn pri"
              style={{ width: '100%', marginTop: 8 }}
              disabled={refund.isPending || !Number(refundAmount)}
              onClick={() => refund.mutate()}
            >
              {refund.isPending ? 'Refunding…' : 'Issue refund'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
