import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { ImageLightbox } from '@/components/FilePreview';
import { useTopbarLead } from '@/components/Shell';
import { useDialog } from '@/components/ui/AppDialog';
import { ErrorBanner } from '@/components/ui/EmptyState';
import { apiFetch, downloadSignedFile, getErrorMessage, resolveFileUrl } from '@/lib/api';
import { refundOrder } from '@/lib/billing';
import type { RefundTo } from '@/lib/billing';
import { createDesign, updateDesign, type Design, type DesignStatus } from '@/lib/designs';
import {
  createAdminEdit,
  deleteAdminEdit,
  getOrderActivity,
  listAdminOrderEdits,
  updateAdminEdit,
} from '@/lib/edits';
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
import {
  dateShort,
  deliveredViaFromFlags,
  deliveryMethodLabel,
  isImageFile,
  money,
  orderDeliveredVia,
  orderNumber,
  revisionDeliveryState,
} from '@/lib/format';
import { createAdminConversation } from '@/lib/messaging';
import {
  adminAttachmentUrl,
  adminDeliveryFileUrl,
  deleteAdminOrder,
  deliverOrder,
  updateOrderNotes,
} from '@/lib/orders';
import { invalidateWorkCaches } from '@/lib/queryCache';
import {
  canPriceOrder,
  needsOrderPricing,
  quoteHistoryLabel,
  studioQuotation,
  type QuoteWithLines,
} from '@/lib/quoteHelpers';
import { AdminOrderPricing } from '@/components/AdminOrderPricing';
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

type RevisionDraft = {
  key: string;
  rowKey: string;
  note: string;
  price: string;
  free: boolean;
};

function blankRevision(rowKey: string): RevisionDraft {
  return { key: crypto.randomUUID(), rowKey, note: '', price: '', free: false };
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
  const requestedFormats = (prefs?.formats ?? []).filter((fmt) => !/preview/i.test(fmt));
  const wantsPreview = (prefs?.formats ?? []).some((fmt) => /preview/i.test(fmt));
  const requestDesigns = embroideryDesigns(order.preferences, order.name);
  const quotations = (order.quotations ?? []) as QuoteWithLines[];
  const studio = studioQuotation(quotations);
  const lines = studio?.lines ?? [];
  const groups = orderDeliveryGroups(order, lines);
  const counts = deliveryCounts(groups);
  const via = orderDeliveredVia(order);
  const accepted = lines.filter((line) => line.clientDecision !== 'DROPPED').length || counts.total;
  const quoted = lines.length || counts.total;
  const paid = order.paymentStatus === 'PAID';
  const amountPaid = paid ? order.priceCents : 0;
  const unpriced = needsOrderPricing(order);
  const showPricing = canPriceOrder(order);
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
  const suppressPublishClick = useRef(false);
  const [pendingZip, setPendingZip] = useState<File | null>(null);
  const [deliveredOnEmail, setDeliveredOnEmail] = useState(false);
  const [filesFor, setFilesFor] = useState<{ row: DeliveryRow; editId: string | null } | null>(null);
  const [uploadEditId, setUploadEditId] = useState<string | null>(null);
  const [uploadRows, setUploadRows] = useState<DeliveryRow[]>([]);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionDrafts, setRevisionDrafts] = useState<RevisionDraft[]>([]);
  const [revisionDesignerId, setRevisionDesignerId] = useState('');
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const revModalRef = useRef<HTMLDivElement>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState(((order.priceCents ?? 0) / 100).toFixed(2));
  const [refundTo, setRefundTo] = useState<RefundTo>('STORE_CREDIT');
  const [refundReason, setRefundReason] = useState('');

  useEffect(() => setNotes(order.internalNotes ?? ''), [order.internalNotes]);
  useEffect(() => setDesignerId(order.assignedDesignerId ?? ''), [order.assignedDesignerId]);
  useLayoutEffect(() => {
    const modal = revModalRef.current;
    if (!revisionOpen || !modal) return;
    modal.style.height = '';
    modal.style.height = `${modal.offsetHeight}px`;
    return () => {
      modal.style.height = '';
    };
  }, [revisionOpen]);

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
    mutationFn: async ({
      row,
      files,
      zip,
      emailed,
    }: {
      row: DeliveryRow;
      files: File[];
      zip?: File | null;
      emailed: boolean;
    }) => {
      const targets = uploadRows.length > 0 ? uploadRows : [row];
      const designIds: string[] = [];
      for (const item of targets) designIds.push(await ensureDesign(item));
      const hasPortal = files.length > 0 || Boolean(zip);
      return deliverOrder(order.id, files, {
        designIds,
        deliveredVia: deliveredViaFromFlags(hasPortal, emailed),
        zip: zip ?? undefined,
        notifyEmail: hasPortal,
        release: true,
        kind: 'FINAL',
        editId: uploadEditId,
      });
    },
    onSuccess: () => {
      setUploadFor(null);
      setUploadRows([]);
      setUploadEditId(null);
      setPendingFiles([]);
      setPendingZip(null);
      setDeliveredOnEmail(false);
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
    mutationFn: async () => {
      const rows = groups.flatMap((group) => group.rows);
      const created: string[] = [];
      for (const line of revisionDrafts) {
        const chosen = rows.find((row) => row.key === line.rowKey) ?? rows[0];
        if (!chosen) throw new Error('Pick a design and size.');
        const dollars = Number(line.price);
        const priceCents = line.free ? null : Math.round(dollars * 100);
        const designIds = [await ensureDesign(chosen)];
        const result = await createAdminEdit(order.id, {
          note: line.note.trim(),
          kind: line.free ? 'FREE' : 'PAID',
          priceCents,
          designIds,
          assignedDesignerId: revisionDesignerId || null,
        });
        created.push(result.edit.id);
        setRevisionDrafts((prev) => prev.filter((item) => item.key !== line.key));
      }
      return created;
    },
    onSuccess: async (created) => {
      const count = created.length;
      setRevisionOpen(false);
      setRevisionDrafts([]);
      setRevisionDesignerId('');
      setRevisionError(null);
      refresh();
      await dialog.alert({
        title: count === 1 ? 'Revision created' : 'Revisions created',
        message:
          count === 1
            ? 'This order is now revision requested. The customer keeps the current files until you publish the new ones. Publishing them marks the order delivered again.'
            : `${count} revisions were added. The customer keeps the current files until you publish the new ones.`,
        confirmLabel: 'Done',
        tone: 'success',
      });
    },
    onError: (e) => {
      refresh();
      setError(getErrorMessage(e));
    },
  });

  const markRevisionReady = useMutation({
    mutationFn: (editId: string) => updateAdminEdit(editId, { ready: true }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const removeRevision = useMutation({
    mutationFn: (id: string) => deleteAdminEdit(id),
    onSuccess: async () => {
      refresh();
      await dialog.alert({
        title: 'Revision deleted',
        message: 'That revision request was removed. The order status follows the designs that are still open.',
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
  const hasReleasedFiles = (row: DeliveryRow) => {
    const designId = row.design?.id;
    if (!designId) return false;
    return (order.deliveries ?? []).some(
      (batch) =>
        Boolean(batch.releasedAt) &&
        batch.kind !== 'PREVIEW' &&
        batch.files.some((file) => file.designId === designId && !file.isBundle),
    );
  };
  async function previewFile(file: { id: string; originalName: string; mimeType?: string | null }) {
    setError(null);
    const image = isImageFile(file.originalName, file.mimeType);
    const tab = image ? null : window.open('', '_blank', 'noopener');
    try {
      const { url } = await apiFetch<{ url: string }>(
        `${adminDeliveryFileUrl(order.id, file.id)}?inline=1`,
      );
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

  const edits = editsQ.data?.edits ?? [];
  const revisionOwnerId = (batch: { editId?: string | null; createdAt?: string }) => {
    if (batch.editId) return batch.editId;
    const at = batch.createdAt ? new Date(batch.createdAt).getTime() : 0;
    let owner: string | null = null;
    for (const edit of edits) {
      if (at >= new Date(edit.createdAt).getTime() - 2000) owner = edit.id;
    }
    return owner;
  };
  const scopedDeliveryFiles = (row: DeliveryRow, editId: string | null) => {
    const designId = row.design?.id;
    return (order.deliveries ?? []).flatMap((batch) => {
      const owner = revisionOwnerId(batch);
      if (editId ? owner !== editId : Boolean(owner)) return [];
      return batch.files.filter((file) => !file.isBundle && file.designId === designId);
    });
  };
  const scopedBundleFiles = (editId: string | null) =>
    (order.deliveries ?? []).flatMap((batch) => {
      const owner = revisionOwnerId(batch);
      if (editId ? owner !== editId : Boolean(owner)) return [];
      return batch.files.filter((file) => file.isBundle);
    });
  const editDesignIds = (edit: { designIds?: string[]; designId?: string | null }) =>
    edit.designIds?.length ? edit.designIds : edit.designId ? [edit.designId] : [];
  const allRows = groups.flatMap((group) => group.rows);
  const rowsForEdit = (edit: { designIds?: string[]; designId?: string | null }) => {
    const ids = editDesignIds(edit);
    if (ids.length === 0) return allRows;
    return allRows.filter((row) => Boolean(row.design && ids.includes(row.design.id)));
  };
  const revisionPhase = (edit: { status: string; readyAt?: string | null }) => {
    if (edit.status === 'DONE') return 'published' as const;
    if (edit.readyAt) return 'ready' as const;
    return 'requested' as const;
  };
  const revisionFiles = (editId: string) =>
    (order.deliveries ?? []).flatMap((batch) => {
      if (revisionOwnerId(batch) !== editId) return [];
      return batch.files;
    });
  const revisionTargetLabel = (edit: { designIds?: string[]; designId?: string | null }) => {
    const covered = rowsForEdit(edit);
    if (covered.length === 0) return '';
    return covered
      .map((row) => {
        const group = groups.find((item) => item.rows.some((candidate) => candidate.key === row.key));
        return group ? `${group.title} · ${row.name}` : row.name;
      })
      .join(', ');
  };
  const rowInRevision = (row: DeliveryRow) =>
    edits.some(
      (edit) =>
        edit.status === 'PENDING' &&
        Boolean(row.design && editDesignIds(edit).includes(row.design.id)),
    );
  const phaseFor = (row: DeliveryRow) => {
    const status = row.design?.status;
    if (rowInRevision(row) && status !== 'DELIVERED') return 'progress' as const;
    return linePhase(status);
  };
  const revisionState = revisionDeliveryState(edits, (id) => {
    const row = groups.flatMap((group) => group.rows).find((item) => item.design?.id === id);
    return row?.design?.status;
  });
  const revisionRequested =
    order.status === 'REVISION_REQUESTED' || edits.some((edit) => edit.status === 'PENDING');
  const headerLabel = unpriced
    ? 'Needs your price'
    : order.status === 'PENDING_PAYMENT'
      ? 'Awaiting payment'
      : revisionState === 'partial'
        ? 'Partially delivered'
      : revisionRequested
        ? 'Revision requested'
        : counts.allDelivered
          ? 'Delivered'
          : counts.delivered > 0 && counts.delivered < counts.total
            ? 'Partially delivered'
            : 'In process';

  function openFilePicker(inputId: string) {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return;
    suppressPublishClick.current = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      window.setTimeout(() => {
        suppressPublishClick.current = false;
      }, 400);
    };
    window.addEventListener('focus', release, { once: true });
    input.click();
  }

  function openPublish(row: DeliveryRow, editId: string | null = null, rows: DeliveryRow[] = [row]) {
    setUploadEditId(editId);
    setUploadFor(row);
    setUploadRows(rows);
    setPendingFiles([]);
    setPendingZip(null);
    setDeliveredOnEmail(false);
  }

  function lineActions(row: DeliveryRow, source: 'order' | 'revision' = 'order', revisionId: string | null = null) {
    const phase =
      source === 'order' && rowInRevision(row) && hasReleasedFiles(row)
        ? ('delivered' as const)
        : phaseFor(row);
    const view = deliveredFiles(row).length > 0 ? (
      <button
        type="button"
        className="sod-eye"
        title="View delivered files"
        onClick={() => setFilesFor({ row, editId: null })}
      >
        <i className="ti ti-eye" />
      </button>
    ) : null;
    if (phase === 'progress') {
      return (
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
          <button type="button" className="ead-btn sm pri" onClick={() => openPublish(row, source === 'revision' ? revisionId : null)}>
            Attach & publish
          </button>
          {view}
        </>
      );
    }
    if (phase === 'ready') {
      return (
        <>
          <span className="sod-status ready">Ready</span>
          <button type="button" className="ead-btn sm pri" onClick={() => openPublish(row, source === 'revision' ? revisionId : null)}>
            Attach & publish
          </button>
          {view}
        </>
      );
    }
    return (
      <>
        <span className="sod-status ready">Delivered</span>
        {view}
      </>
    );
  }

  return (
    <div className="ead">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="ead-head">
        <div>
          <h1>{order.name?.trim() || 'Order'}</h1>
          <div className="ead-meta">
            <span className={headerLabel === 'Delivered' ? 'ead-pill ok' : 'ead-pill'}>
              {headerLabel}
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
          {!unpriced && (
            <button
              type="button"
              className="ead-btn"
              onClick={() => {
                const rows = groups.flatMap((group) => group.rows);
                setRevisionDrafts([blankRevision(rows[0]?.key ?? '')]);
                setRevisionDesignerId('');
                setRevisionError(null);
                setRevisionOpen(true);
              }}
            >
              <i className="ti ti-pencil" /> Create revision
            </button>
          )}
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
            {unpriced ? 'Waiting for prices' : `${accepted} of ${quoted} accepted`}
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
                {groups.flatMap((group) => group.rows).filter((row) =>
                  rowInRevision(row) && hasReleasedFiles(row)
                    ? true
                    : row.design?.status === 'DELIVERED',
                ).length}{' '}
                of {counts.total} items approved
                {via ? ` · ${deliveryMethodLabel(via)}` : ''}
              </span>
            </div>
            <div className="ead-b">
              {groups.length === 0 && (
                <div className="ead-he-sub">
                  {unpriced
                    ? 'Enter the order prices to add the items for this order.'
                    : 'No priced items on this order yet.'}
                </div>
              )}
              {groups.map((group, groupIndex) => (
                <div key={group.title} className="sod-group" style={groupIndex === 0 ? { marginTop: 0 } : undefined}>
                  <h3>{group.title}</h3>
                  {group.rows.map((row) => (
                    <div key={row.key} className="sod-line">
                      <b>{row.name}</b>
                      <div className="sod-acts">{lineActions(row)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {edits.length > 0 && (
          <section className="ead-card">
            <div className="ead-card-h">
              <span className="ead-ic"><i className="ti ti-refresh" /></span>
              <h2>Customer revision</h2>
            </div>
            {edits.map((edit) => {
              const covered = rowsForEdit(edit);
              const phase = revisionPhase(edit);
              const paid = edit.kind === 'PAID' && (edit.priceCents ?? 0) > 0;
              const settled = edit.invoiceStatus === 'PAID';
              const names = revisionFiles(edit.id).map((file) => file.originalName);
              const target = revisionTargetLabel(edit);
              return (
                <div key={edit.id} className="rev-row" title={target || undefined}>
                  <div className="rev-note">
                    <span>{edit.note}</span>
                    {names.map((name, index) => (
                      <span key={`${name}-${index}`} className="rev-chip" title={name}>{name}</span>
                    ))}
                  </div>
                  <div className="rev-acts">
                    {paid ? (
                      <>
                        <b className="rev-price">{money(edit.priceCents, order.currency)}</b>
                        <span className={settled ? 'ead-pill ok plain' : 'ead-pill bad plain'}>
                          {settled ? 'Paid' : 'Unpaid'}
                        </span>
                      </>
                    ) : (
                      <span className="rev-free">Free revision</span>
                    )}
                    {phase === 'ready' && <span className="rev-status ready">● Revision ready</span>}
                    {phase === 'published' && <span className="rev-status done">✓ Delivered</span>}
                    {phase === 'requested' && <span className="ead-pill blue plain">In progress</span>}
                    {phase === 'ready' && <span className="ead-pill ok plain">Ready</span>}
                    {phase === 'requested' && (
                      <button
                        type="button"
                        className="ead-btn sm"
                        disabled={markRevisionReady.isPending}
                        onClick={() => markRevisionReady.mutate(edit.id)}
                      >
                        Mark ready
                      </button>
                    )}
                    {phase !== 'published' && (
                      <>
                        <button
                          type="button"
                          className="ead-btn sm pri"
                          disabled={covered.length === 0}
                          onClick={() => openPublish(covered[0], edit.id, covered)}
                        >
                          Attach & publish
                        </button>
                        <button
                          type="button"
                          className="ead-btn sm icon"
                          title="Delete revision"
                          aria-label="Delete revision"
                          disabled={removeRevision.isPending}
                          onClick={() => {
                            const paidNote = paid && settled
                              ? 'This revision was already paid. Deleting it will not refund the customer; issue the refund separately. '
                              : '';
                            void dialog
                              .confirm({
                                title: 'Delete this revision?',
                                message: `${paidNote}“${edit.note}” will be removed from Customer revision and Quote history, and the customer will no longer see it.`,
                                confirmLabel: 'Delete revision',
                                cancelLabel: 'Keep revision',
                                danger: true,
                              })
                              .then((ok) => {
                                if (ok) removeRevision.mutate(edit.id);
                              });
                          }}
                        >
                          <i className="ti ti-trash" />
                        </button>
                      </>
                    )}
                    {phase === 'published' && covered[0] && (
                      <button
                        type="button"
                        className="ead-btn sm icon"
                        title="View delivered files"
                        aria-label="View delivered files"
                        onClick={() => setFilesFor({ row: covered[0], editId: edit.id })}
                      >
                        <i className="ti ti-eye" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
                const label = designOptionLabel(index, design.name);
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
                              {!cutting && <th><span>Embroidered on</span></th>}
                              <th><span>Proportional</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {sizes.map((size, sizeIndex) => (
                              <tr key={`${size.detail ?? 'size'}-${sizeIndex}`}>
                                <td>
                                  <span className="ecd-size-n">{sizeIndex + 1}</span>
                                  {sizeDetail(size)}
                                </td>
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
                {history.length + edits.length} {history.length + edits.length === 1 ? 'version' : 'versions'} · {accepted}/{quoted} items accepted
              </span>
            </div>
            <div className="ead-b">
              {history.length === 0 && edits.length === 0 && (
                <div className="ead-he-sub">
                  {unpriced
                    ? 'Prices appear here after you save them.'
                    : 'No quote has been sent yet.'}
                </div>
              )}
              {history.map((quote) => {
                const acceptedPaid = quote.status === 'APPROVED' && paid;
                const status = acceptedPaid
                  ? 'Accepted & paid'
                  : quote.status === 'APPROVED'
                    ? 'Accepted'
                    : quote.status === 'SENT'
                      ? 'Sent'
                      : quote.status === 'COUNTERED'
                        ? 'Countered'
                        : quote.status === 'REJECTED'
                          ? 'Rejected'
                          : quote.status;
                return (
                  <div key={quote.id} className="rev-q">
                    <div className="rev-q-line">
                      <b>{quoteHistoryLabel(quote, history)}</b>
                      <b>{money(quote.amountCents, quote.currency)}</b>
                      <span className="ead-he-sub" style={{ marginTop: 0 }}>{status}</span>
                    </div>
                    <div className="ead-he-sub">
                      {dateShort(quote.createdAt)}
                      {quote.comment ? ` · ${quote.comment}` : ''}
                    </div>
                  </div>
                );
              })}
              {edits.map((edit) => {
                const charged = edit.kind === 'PAID' && (edit.priceCents ?? 0) > 0;
                const settled = edit.invoiceStatus === 'PAID';
                return (
                  <div key={edit.id} className="rev-q">
                    <div className="rev-q-line">
                      <b>{charged ? 'Paid revision' : 'Free revision'}</b>
                      {charged && <b>{money(edit.priceCents, order.currency)}</b>}
                      <span className="ead-he-sub" style={{ marginTop: 0 }}>
                        {charged ? (settled ? 'Accepted & paid' : 'Awaiting payment') : 'No charge'}
                      </span>
                    </div>
                    <div className="ead-he-sub">
                      {dateShort(edit.createdAt)} · {edit.note}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="ead-rail">
          {showPricing && <AdminOrderPricing order={order} />}

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
        <div
          className="sod-ov"
          role="presentation"
          onClick={() => {
            if (publish.isPending) return;
            setUploadFor(null);
            setPendingFiles([]);
            setPendingZip(null);
            setDeliveredOnEmail(false);
          }}
        >
          <div className="sod-mo" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sod-mo-h">
              <h3>Upload design</h3>
              <button
                type="button"
                onClick={() => {
                  setUploadFor(null);
                  setPendingFiles([]);
                  setPendingZip(null);
                  setDeliveredOnEmail(false);
                }}
                aria-label="Close"
              >
                <i className="ti ti-x" />
              </button>
            </div>
            <p>Add up to 10 files, then select Publish files.</p>
            {requestedFormats.length > 0 && (
              <p>
                <b>Requested formats: </b>
                {requestedFormats.join(', ')}
              </p>
            )}
            {wantsPreview && <p>For Preview Purpose</p>}
            <button type="button" className="sod-drop" onClick={() => openFilePicker('sod-files')}>
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
              {pendingFiles.map((file, index) => (
                <div key={`${file.name}-${file.size}-${file.lastModified}`} className="sod-file">
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="ead-btn sm"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="ead-he-sub">{pendingFiles.length} of 10 files attached</div>
            <div className="sod-label">All designs zip (optional)</div>
            <p>Upload one zip that contains every design in this order.</p>
            <button type="button" className="sod-drop sod-drop-sm" onClick={() => openFilePicker('sod-zip')}>
              <i className="ti ti-file-zip" /> {pendingZip ? pendingZip.name : 'Choose zip'}
            </button>
            <input
              id="sod-zip"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              hidden
              onChange={(e) => {
                setPendingZip(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            {pendingZip && (
              <button type="button" className="ead-btn sm sod-zip-remove" onClick={() => setPendingZip(null)}>
                Remove zip
              </button>
            )}
            <label className="sod-check">
              <input
                type="checkbox"
                checked={deliveredOnEmail}
                onChange={(e) => setDeliveredOnEmail(e.target.checked)}
              />
              Delivered on email
            </label>
            <div className="sod-mo-f">
              <button
                type="button"
                className="ead-btn"
                onClick={() => {
                  setUploadFor(null);
                  setPendingFiles([]);
                  setPendingZip(null);
                  setDeliveredOnEmail(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ead-btn pri"
                disabled={
                  publish.isPending ||
                  (pendingFiles.length === 0 && !pendingZip && !deliveredOnEmail)
                }
                onClick={() => {
                  if (suppressPublishClick.current) return;
                  publish.mutate({
                    row: uploadFor,
                    files: pendingFiles,
                    zip: pendingZip,
                    emailed: deliveredOnEmail,
                  });
                }}
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
              <h3>{filesFor.editId ? 'Revision files' : 'Delivered files'}</h3>
              <button type="button" onClick={() => setFilesFor(null)} aria-label="Close">
                <i className="ti ti-x" />
              </button>
            </div>
            <p>
              {filesFor.editId
                ? 'These files belong to this revision.'
                : 'Preview or download the original delivered files.'}
            </p>
            <div className="sod-flist">
              {(() => {
                const shown = filesFor.editId
                  ? revisionFiles(filesFor.editId)
                  : [...scopedDeliveryFiles(filesFor.row, null), ...scopedBundleFiles(null)];
                if (shown.length === 0) return <div>No files published for this item yet.</div>;
                return shown.map((file) => (
                  <div key={file.id} className="sod-file">
                    <span>{file.originalName}{file.isBundle ? ' (all designs)' : ''}</span>
                    <span className="sod-file-acts">
                      {!file.isBundle && (
                        <button
                          type="button"
                          className="sod-eye"
                          title="Preview"
                          aria-label={`Preview ${file.originalName}`}
                          onClick={() => void previewFile(file)}
                        >
                          <i className="ti ti-eye" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="sod-eye"
                        title={file.isBundle ? 'Download zip' : 'Download'}
                        aria-label={`Download ${file.originalName}`}
                        onClick={() => void downloadSignedFile(adminDeliveryFileUrl(order.id, file.id), file.originalName)}
                      >
                        <i className="ti ti-download" />
                      </button>
                    </span>
                  </div>
                ));
              })()}
            </div>
            <div className="sod-mo-f">
              <button type="button" className="ead-btn" onClick={() => setFilesFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {revisionOpen && (
        <div className="sod-ov" role="presentation" onClick={() => { if (!revision.isPending) setRevisionOpen(false); }}>
          <div
            ref={revModalRef}
            className="cr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-rev-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cr-head">
              <h2 id="create-rev-title">Create revision {quoteNo}</h2>
              <button type="button" className="cr-x" onClick={() => setRevisionOpen(false)} aria-label="Close" disabled={revision.isPending}>
                ×
              </button>
            </div>
            <div className="cr-scroll">
              {revisionDrafts.map((line, index) => (
                <div key={line.key} className="cr-rev">
                  <div className="cr-rev-h">
                    <b>Revision {index + 1}</b>
                    <button
                      type="button"
                      className="cr-rm"
                      style={{ display: revisionDrafts.length > 1 ? undefined : 'none' }}
                      onClick={() => setRevisionDrafts((prev) => prev.filter((item) => item.key !== line.key))}
                    >
                      Remove
                    </button>
                  </div>
                  {allRows.length > 0 && (
                    <>
                      <label htmlFor={`cr-size-${line.key}`}>Design & size</label>
                      <select
                        id={`cr-size-${line.key}`}
                        value={line.rowKey}
                        onChange={(e) =>
                          setRevisionDrafts((prev) =>
                            prev.map((item) => (item.key === line.key ? { ...item, rowKey: e.target.value } : item)),
                          )
                        }
                      >
                        {groups.flatMap((group) =>
                          group.rows.map((row) => (
                            <option key={row.key} value={row.key}>
                              {group.title} · {row.name}
                            </option>
                          )),
                        )}
                      </select>
                    </>
                  )}
                  <label htmlFor={`cr-note-${line.key}`}>Description</label>
                  <textarea
                    id={`cr-note-${line.key}`}
                    placeholder='e.g. resize eagle to 3", make text bolder for stitching'
                    value={line.note}
                    onChange={(e) => {
                      const note = e.target.value;
                      setRevisionError(null);
                      setRevisionDrafts((prev) => prev.map((item) => (item.key === line.key ? { ...item, note } : item)));
                    }}
                  />
                  <label htmlFor={`cr-price-${line.key}`}>Price</label>
                  <div className="cr-prow">
                    <div className="cr-price">
                      <span>$</span>
                      <input
                        id={`cr-price-${line.key}`}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={line.free ? '0' : line.price}
                        disabled={line.free}
                        onChange={(e) => {
                          const price = e.target.value;
                          setRevisionError(null);
                          setRevisionDrafts((prev) =>
                            prev.map((item) => (item.key === line.key ? { ...item, price } : item)),
                          );
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="cr-free"
                      aria-pressed={line.free}
                      onClick={() =>
                        setRevisionDrafts((prev) =>
                          prev.map((item) =>
                            item.key === line.key
                              ? { ...item, free: !item.free, price: item.free ? '' : '0' }
                              : item,
                          ),
                        )
                      }
                    >
                      Free
                    </button>
                  </div>
                </div>
              ))}
              {revisionError && <div className="cr-err">{revisionError}</div>}
              <button
                type="button"
                className="cr-add"
                onClick={() =>
                  setRevisionDrafts((prev) => [...prev, blankRevision(prev[0]?.rowKey || allRows[0]?.key || '')])
                }
              >
                + Add another revision
              </button>
            </div>
            <div className="cr-foot">
              <div className="cr-total">
                <span>Total revision price</span>
                <b>
                  {money(
                    Math.round(
                      revisionDrafts.reduce((sum, line) => sum + (line.free ? 0 : Number(line.price) || 0), 0) * 100,
                    ),
                    order.currency,
                  )}
                </b>
              </div>
              <label htmlFor="cr-designer">Assign to designer</label>
              <select
                id="cr-designer"
                value={revisionDesignerId}
                onChange={(e) => setRevisionDesignerId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {designerOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {personName(member)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="cr-go"
                disabled={revision.isPending || allRows.length === 0}
                onClick={() => {
                  for (let i = 0; i < revisionDrafts.length; i += 1) {
                    const line = revisionDrafts[i];
                    if (!line.note.trim()) {
                      setRevisionError(`Enter a description for revision ${i + 1}.`);
                      return;
                    }
                    if (!line.free && !(Number(line.price) > 0)) {
                      setRevisionError(`Enter a price for revision ${i + 1}, or mark it free.`);
                      return;
                    }
                    if (!line.rowKey) {
                      setRevisionError(`Pick a design and size for revision ${i + 1}.`);
                      return;
                    }
                  }
                  setRevisionError(null);
                  revision.mutate();
                }}
              >
                {revision.isPending ? 'Creating…' : 'Create revision'}
              </button>
            </div>
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
      {preview && (
        <ImageLightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
