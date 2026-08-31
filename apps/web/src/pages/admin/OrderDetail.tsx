import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminAttachmentUrl,
  adminDeliveryFileUrl,
  adminUpdateStatus,
  adminUploadAttachments,
  approveCounter,
  deleteAdminDeliveryFile,
  deleteAdminOrder,
  deliverOrder,
  getAdminOrder,
  fulfillAdminFormatRequest,
  listAdminFormatRequests,
  resendOrderFiles,
  updateAdminFormatRequest,
  updateOrderNotes,
  type FormatRequest,
} from '@/lib/orders';
import { applyOrderChange, cacheOrder, invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { createAdminEdit, getOrderActivity, listAdminOrderEdits, type EditKind } from '@/lib/edits';
import {
  getAdminConversation,
  listAdminConversations,
  listMessageTemplates,
  sendAdminMessage,
  createAdminConversation,
} from '@/lib/messaging';
import { createInvoice, createPayLink, listInvoices, payInvoice, refundOrder, type RefundTo } from '@/lib/billing';
import { assignOrder, listTeam, unassignOrder } from '@/lib/team';
import {
  designStatusChipClass,
  designStatusLabel,
  updateDesign,
  type Design,
  type DesignStatus,
} from '@/lib/designs';
import { apiFetch, downloadSignedFile, getErrorMessage, resolveFileUrl } from '@/lib/api';
import { money, dateShort, lifecycleChip } from '@/lib/format';
import { AdminCounterDecision } from '@/components/AdminCounterDecision';
import { FormPreferencesDisplay } from '@/components/FormPreferencesDisplay';
import { MessageAttachments } from '@/components/MessageAttachments';
import { QuoteHistory } from '@/components/QuoteHistory';
import { isStaffCreatedOrder, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import type { Order, OrderStatus } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { canFeature, canSupport } from '@/lib/permissions';

type AdminOrderFull = Order & {
  assignedDesignerId?: string | null;
  dueDate?: string | null;
  customerId?: string | null;
  internalNotes?: string | null;
  designs?: Design[];
};

function feeDollarsToCents(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

function customerName(order: AdminOrderFull) {
  const c = order.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function payBadge(
  status: OrderStatus,
  priceCents: number | null,
  paid: boolean,
) {
  if (status === 'REFUNDED') return { cls: 'pay-badge pay-unpaid', text: 'Refunded' };
  if (paid) return { cls: 'pay-badge pay-paid', text: 'Paid in full' };
  if (status === 'PENDING_PAYMENT') return { cls: 'pay-badge pay-unpaid', text: 'Awaiting payment' };
  if (priceCents && priceCents > 0) return { cls: 'pay-badge pay-deposit', text: 'Unpaid' };
  return { cls: 'pay-badge pay-unpaid', text: 'Not priced' };
}

function relativeTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function isImageName(name: string, mime?: string | null) {
  if (mime?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function LocalPublishFiles({
  files,
  disabled,
  onRemove,
}: {
  files: File[];
  disabled?: boolean;
  onRemove: (index: number) => void;
}) {
  const urls = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')),
    [files],
  );
  useEffect(() => {
    return () => {
      urls.forEach((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    };
  }, [urls]);

  return (
    <div className="pub-files">
      {files.map((f, i) => (
        <div key={`${f.name}-${f.size}-${f.lastModified}`} className="pub-file">
          {urls[i] ? (
            <img src={urls[i]} alt={f.name} />
          ) : (
            <div className="pub-file-icon">
              <i className="ti ti-file" />
            </div>
          )}
          <span title={f.name}>{f.name}</span>
          <button
            type="button"
            className="pub-file-x"
            disabled={disabled}
            aria-label={`Remove ${f.name}`}
            onClick={() => onRemove(i)}
          >
            <i className="ti ti-trash" />
          </button>
        </div>
      ))}
    </div>
  );
}

function SavedPublishFile({
  orderId,
  file,
  waiting,
  canDelete,
  deleting,
  onDelete,
}: {
  orderId: string;
  file: { id: string; originalName: string; mimeType?: string | null };
  waiting?: boolean;
  canDelete: boolean;
  deleting?: boolean;
  onDelete: () => void;
}) {
  const showImg = isImageName(file.originalName, file.mimeType);
  const thumbQ = useQuery({
    queryKey: ['delivery-thumb', orderId, file.id],
    queryFn: async () => {
      const { url } = await apiFetch<{ url: string }>(adminDeliveryFileUrl(orderId, file.id));
      return resolveFileUrl(url);
    },
    enabled: showImg,
    staleTime: 60_000,
  });

  return (
    <div className={`pub-file${waiting ? ' wait' : ''}`}>
      <button
        type="button"
        className="pub-file-open"
        onClick={() => downloadSignedFile(adminDeliveryFileUrl(orderId, file.id), file.originalName)}
      >
        {thumbQ.data ? (
          <img src={thumbQ.data} alt={file.originalName} />
        ) : (
          <div className="pub-file-icon">
            <i className="ti ti-file" />
          </div>
        )}
        <span title={file.originalName}>{file.originalName}</span>
      </button>
      {canDelete && (
        <button
          type="button"
          className="pub-file-x"
          disabled={deleting}
          aria-label={`Delete ${file.originalName}`}
          onClick={onDelete}
        >
          <i className="ti ti-trash" />
        </button>
      )}
    </div>
  );
}

export function AdminOrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const showMoney = canFeature(user?.permissions, 'billing', user?.role);
  const canAssignDesigner =
    (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') &&
    canFeature(user?.permissions, 'team', user?.role);
  const canApprove = canSupport(user?.permissions, 'approve', user?.role);
  const canApproveCounter = canApprove;
  const isDesigner = user?.role === 'DESIGNER';
  const canPublishToCustomer = canApprove;
  const showSendForApproval =
    !canPublishToCustomer && (isDesigner || user?.role === 'SUPPORT');
  const canMessageCustomer = canFeature(
    user?.permissions,
    'messages_customer_reply',
    user?.role,
  );
  const [msgDraft, setMsgDraft] = useState('');
  const [msgFiles, setMsgFiles] = useState<File[]>([]);
  const [refUploading, setRefUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [designerId, setDesignerId] = useState('');
  const [notifyPortal, setNotifyPortal] = useState(true);
  const [publishFor, setPublishFor] = useState<Design | null>(null);
  const [publishFiles, setPublishFiles] = useState<File[]>([]);
  const [publishSaved, setPublishSaved] = useState(false);
  const [formatFiles, setFormatFiles] = useState<Record<string, File[]>>({});
  const [formatPrices, setFormatPrices] = useState<Record<string, string>>({});
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRevision, setShowRevision] = useState(false);
  const [showRefund, setShowRefund] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: () => getAdminOrder(id),
    ...freshOnOpen,
  });

  const activityQ = useQuery({
    queryKey: ['admin-order-activity', id],
    queryFn: () => getOrderActivity(id),
    enabled: !!id,
  });

  const editsQ = useQuery({
    queryKey: ['admin-order-edits', id],
    queryFn: () => listAdminOrderEdits(id),
    enabled: !!id,
    ...freshOnOpen,
  });

  const teamQ = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
  });

  const convosQ = useQuery({
    queryKey: ['admin-conversations-order', id],
    queryFn: () => listAdminConversations({ orderId: id }),
    enabled: !!id,
  });

  const order = data?.order as AdminOrderFull | undefined;
  const invoicesQ = useQuery({
    queryKey: ['admin-invoices-order', id, order?.customerId],
    queryFn: () =>
      listInvoices({
        customerId: order?.customerId ?? undefined,
        status: 'PAID',
      }),
    enabled: showMoney && !!id && !!order?.customerId,
  });
  const convo = useMemo(
    () => convosQ.data?.conversations.find((c) => c.orderId === id),
    [convosQ.data, id],
  );

  useEffect(() => {
    if (order) setNotes(order.internalNotes ?? '');
  }, [order?.internalNotes, id]);

  useEffect(() => {
    setDesignerId(order?.assignedDesignerId ?? '');
  }, [order?.assignedDesignerId]);

  const templatesQ = useQuery({
    queryKey: ['message-templates'],
    queryFn: listMessageTemplates,
  });

  const formatReqQ = useQuery({
    queryKey: ['admin-format-requests', id],
    queryFn: () => listAdminFormatRequests(id),
    enabled: !!id,
  });

  const threadQ = useQuery({
    queryKey: ['admin-conversation', convo?.id],
    queryFn: () => getAdminConversation(convo!.id),
    enabled: !!convo?.id,
    refetchInterval: whenVisible(15_000),
  });

  const designers = (teamQ.data?.members ?? []).filter((m) => m.role === 'DESIGNER');

  const invalidate = (order?: Order) => {
    void applyOrderChange(qc, order);
  };

  const deliver = useMutation({
    mutationFn: (opts: {
      release: boolean;
      designIds?: string[];
      upload?: File[];
    }) =>
      deliverOrder(id, opts.upload ?? [], {
        deliveredVia: 'PORTAL',
        designIds: opts.designIds,
        notifyEmail: opts.release && notifyPortal,
        notifySms: opts.release && notifyPortal,
        complete: false,
        release: opts.release,
      }),
    onSuccess: (res, opts) => {
      setPublishFiles([]);
      setPublishFor(null);
      setPublishSaved(false);
      if (opts.designIds?.[0]) {
        setEditingIds((prev) => prev.filter((x) => x !== opts.designIds![0]));
      }
      if (!opts.release) {
        setToast('Sent to admin for approval. The customer cannot see these files yet.');
      } else if (res.partial) {
        setToast('This design was sent to the customer. Other designs are still in progress.');
      } else {
        setToast('Files sent to the customer. This order is completed.');
      }
      invalidate(res.order);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const removeDeliveryFile = useMutation({
    mutationFn: (fileId: string) => deleteAdminDeliveryFile(id, fileId),
    onSuccess: (res) => {
      setToast('File removed.');
      invalidate(res.order);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const genInvoice = useMutation({
    mutationFn: async () => {
      if (!order?.priceCents) throw new Error('No price set');
      const customerId = order.customerId;
      if (!customerId) throw new Error('No customer linked to this order');
      return createInvoice({
        customerId,
        orderId: id,
        amountCents: order.priceCents,
        coversText: order.name ?? undefined,
      });
    },
    onSuccess: (res) => {
      setToast(
        res.invoice.status === 'PAID'
          ? 'This order already has a paid invoice.'
          : 'Invoice is ready for the customer.',
      );
      invalidate();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const counterApprove = useMutation({
    mutationFn: () => approveCounter(id),
    onSuccess: (res) => {
      setToast('Counter approved.');
      invalidate(res.order);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const assign = useMutation({
    mutationFn: () =>
      designerId
        ? assignOrder(designerId, id)
        : unassignOrder(id),
    onSuccess: (res) => {
      qc.setQueryData(['admin-order', id], (prev: unknown) => {
        if (!prev || typeof prev !== 'object' || !('order' in prev)) return prev;
        const current = (prev as { order: Order }).order;
        return {
          ...prev,
          order: { ...current, assignedDesignerId: res.assignedDesignerId },
        };
      });
      setToast(res.assignedDesignerId ? 'Designer assigned.' : 'Designer unassigned.');
      void invalidateWorkCaches(qc);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const updateFormatReq = useMutation({
    mutationFn: (vars: { requestId: string; status: FormatRequest['status'] }) =>
      updateAdminFormatRequest(vars.requestId, vars.status),
    onSuccess: (_res, vars) => {
      qc.setQueryData(['admin-format-requests', id], (prev: unknown) => {
        if (!prev || typeof prev !== 'object' || !('requests' in prev)) return prev;
        const data = prev as { requests: FormatRequest[] };
        return {
          ...data,
          requests: data.requests.map((row) =>
            row.id === vars.requestId ? { ...row, status: vars.status } : row,
          ),
        };
      });
      setToast('Format request started. Upload the file when it is ready.');
      void invalidateWorkCaches(qc);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const fulfillFormatReq = useMutation({
    mutationFn: (vars: { requestId: string; files: File[]; amountCents?: number }) =>
      fulfillAdminFormatRequest(vars.requestId, vars.files, vars.amountCents),
    onSuccess: (res, vars) => {
      setFormatFiles((prev) => {
        const next = { ...prev };
        delete next[vars.requestId];
        return next;
      });
      setFormatPrices((prev) => {
        const next = { ...prev };
        delete next[vars.requestId];
        return next;
      });
      qc.setQueryData(['admin-format-requests', id], (prev: unknown) => {
        if (!prev || typeof prev !== 'object' || !('requests' in prev)) return prev;
        const data = prev as { requests: FormatRequest[] };
        return {
          ...data,
          requests: data.requests.map((row) =>
            row.id === vars.requestId
              ? {
                  ...row,
                  status: res.awaitingPayment ? 'IN_PROGRESS' : 'DONE',
                  invoiceId: res.invoiceId ?? row.invoiceId,
                  priceCents: vars.amountCents ?? row.priceCents,
                  invoiceStatus: res.awaitingPayment ? 'AWAITING' : row.invoiceStatus,
                }
              : row,
          ),
        };
      });
      if (res.awaitingPayment) {
        if (res.payLinkUrl) {
          const url = res.payLinkUrl.startsWith('http')
            ? res.payLinkUrl
            : `${window.location.origin}${res.payLinkUrl}`;
          void navigator.clipboard?.writeText(url);
        }
        setToast('Invoice sent. The file is held until they pay. Pay link copied.');
      } else {
        setToast('File sent. The customer can download it from Files.');
      }
      invalidate(res.order);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const formatPayLinkMut = useMutation({
    mutationFn: (invoiceId: string) => createPayLink(invoiceId),
    onSuccess: (res) => {
      const url = `${window.location.origin}${res.url}`;
      void navigator.clipboard?.writeText(url);
      setToast('Pay link copied.');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const formatMarkPaidMut = useMutation({
    mutationFn: (invoiceId: string) => payInvoice(invoiceId, 'CARD'),
    onSuccess: () => {
      setToast('Marked paid. The customer can download the file now.');
      void invalidateWorkCaches(qc);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteAdminOrder(id),
    onSuccess: () => {
      void invalidateWorkCaches(qc);
      navigate('/admin/orders');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const sendMsg = useMutation({
    mutationFn: async ({ body, files: attach }: { body: string; files: File[] }) => {
      if (convo) return sendAdminMessage(convo.id, body, attach);
      const created = await createAdminConversation({
        orderId: id,
        customerId: order?.customerId ?? null,
        chatType: order?.type === 'QUOTE_REQUEST' ? 'QUOTE' : 'ORDER',
        subject: order?.humanRef
          ? `${order?.type === 'QUOTE_REQUEST' ? 'Quotation' : 'Order'} ${order.humanRef} Chat`
          : `${order?.type === 'QUOTE_REQUEST' ? 'Quotation' : 'Order'} #${id.slice(0, 6)} Chat`,
      });
      return sendAdminMessage(created.conversation.id, body, attach);
    },
    onSuccess: () => {
      setMsgDraft('');
      setMsgFiles([]);
      qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      qc.invalidateQueries({ queryKey: ['admin-conversation'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  async function uploadReferenceFiles(selected: FileList | null) {
    const list = Array.from(selected ?? []);
    if (!list.length || !id) return;
    setRefUploading(true);
    setError(null);
    try {
      await adminUploadAttachments(id, list);
      setToast('Reference files uploaded.');
      invalidate();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRefUploading(false);
    }
  }

  const saveNotes = useMutation({
    mutationFn: (value: string) => updateOrderNotes(id, value),
    onSuccess: (res) => {
      setToast('Notes saved.');
      invalidate(res.order);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const payLinkMut = useMutation({
    mutationFn: async () => {
      if (!order?.priceCents) throw new Error('No price set');
      const customerId = order.customerId;
      if (!customerId) throw new Error('No customer linked to this order');
      const inv = await createInvoice({
        customerId,
        orderId: id,
        amountCents: order.priceCents,
        coversText: order.name ?? undefined,
      });
      if (inv.invoice.status === 'PAID') {
        throw new Error('This order is already paid.');
      }
      return createPayLink(inv.invoice.id);
    },
    onSuccess: (res) => {
      const url = `${window.location.origin}${res.url}`;
      void navigator.clipboard?.writeText(url);
      setToast('Customer pay link copied. They can pay by card on that page.');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!order?.priceCents) throw new Error('No price set');
      const customerId = order.customerId;
      if (!customerId) throw new Error('No customer linked to this order');
      const inv = await createInvoice({
        customerId,
        orderId: id,
        amountCents: order.priceCents,
        coversText: order.name ?? undefined,
      });
      if (inv.invoice.status === 'PAID') return { alreadyPaid: true };
      await payInvoice(inv.invoice.id, 'CARD');
      return { alreadyPaid: false };
    },
    onSuccess: (res) => {
      setToast(res.alreadyPaid ? 'This order is already marked paid.' : 'Payment recorded.');
      invalidate();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const setDesignStatus = useMutation({
    mutationFn: (vars: { designId: string; status: DesignStatus }) =>
      updateDesign(id, vars.designId, { status: vars.status }),
    onSuccess: (_res, vars) => {
      if (vars.status === 'WAITING') {
        setEditingIds((prev) => prev.filter((x) => x !== vars.designId));
        setToast('Files removed. This design is waiting again.');
      }
      invalidate();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const resend = useMutation({
    mutationFn: () => resendOrderFiles(id),
    onSuccess: () => setToast('Files notification sent to customer.'),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const updateStatus = useMutation({
    mutationFn: (status: OrderStatus) => adminUpdateStatus(id, status),
    onMutate: async (status) => {
      if (!order) return;
      await qc.cancelQueries({ queryKey: ['admin-order', id] });
      const previous = qc.getQueryData(['admin-order', id]);
      cacheOrder(qc, { ...order, status });
      return { previous };
    },
    onSuccess: (res) => invalidate(res.order),
    onError: (e, _status, ctx) => {
      if (ctx?.previous) qc.setQueryData(['admin-order', id], ctx.previous);
      setError(getErrorMessage(e));
    },
  });

  if (isLoading) return <div className="empty-state"><div className="empty-state-title">Loading order…</div></div>;
  if (!order) return <div className="empty-state"><div className="empty-state-title">Order not found</div></div>;

  const designs = order.designs ?? [];
  const readyCount = designs.filter((d) => d.status === 'DONE' || d.status === 'DELIVERED').length;
  const progCount = designs.filter((d) => d.status === 'IN_PROGRESS').length;
  const deliveryFiles = (order.deliveries ?? []).flatMap((batch) =>
    batch.files.map((f) => ({
      ...f,
      releasedAt: batch.releasedAt ?? null,
    })),
  );
  const filesForDesign = (designId: string) =>
    deliveryFiles.filter((f) => f.designId === designId);
  const hasSubmitted = (designId: string) => filesForDesign(designId).length > 0;
  const hasPendingRelease = (designId: string) =>
    filesForDesign(designId).some((f) => !f.releasedAt);
  const pendingBatches = (order.deliveries ?? []).filter((d) => !d.releasedAt);
  const hasPaidInvoice = (invoicesQ.data?.invoices ?? []).some(
    (inv) => inv.orderId === id && inv.status === 'PAID',
  );
  const canRefund = hasPaidInvoice && order.status !== 'REFUNDED';
  const payment = payBadge(order.status, order.priceCents, hasPaidInvoice);
  const assigned = designers.find((d) => d.id === order.assignedDesignerId);
  const canDeliver =
    order.status === 'IN_PROGRESS' ||
    order.status === 'READY_TO_SEND' ||
    order.status === 'COMPLETED' ||
    order.status === 'REVISION_REQUESTED';
  const openRevision = (editsQ.data?.edits ?? []).find((e) => e.status === 'PENDING');
  const revisionIds = openRevision?.designIds ?? [];
  const designInRevision = (designId: string) =>
    Boolean(openRevision) &&
    (revisionIds.length === 0 || revisionIds.includes(designId));
  const orderChip = lifecycleChip(order.status, 'admin', {
    partiallyAccepted: order.partiallyAccepted,
    partiallyDelivered: order.partiallyDelivered,
  });
  const messages = threadQ.data?.conversation.messages ?? [];
  const activity = activityQ.data?.activity ?? [];
  const hasDeliveries = (order.deliveries ?? []).length > 0;

  return (
    <div>
      <div className="ph">
        <div>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="crumb">
              <a href="/admin/orders" onClick={(e) => { e.preventDefault(); navigate('/admin/orders'); }}>Orders</a>
            </span>
            <span className="crumb">
              <i className="ti ti-chevron-right" aria-hidden />
              <span>#{order.humanRef ?? order.id.slice(0, 6)}</span>
            </span>
          </nav>
          <h1>
            #{order.humanRef ?? order.id.slice(0, 6)} · {order.name ?? 'Order'}
          </h1>
          <div style={{ marginTop: 8 }}>
            <span className={orderChip.cls}>{orderChip.label}</span>
          </div>
          <div className="sub">
            {customerName(order)} · {order.serviceType ?? 'Service'} · {designs.length} designs · placed{' '}
            {dateShort(order.createdAt)}
            {isStaffCreatedOrder(order) ? ' · Created by admin' : ''}
          </div>
        </div>
        <div className="ph-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!hasDeliveries || resend.isPending}
            onClick={() => resend.mutate()}
          >
            <i className="ti ti-send" /> Resend files
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowRevision(true)}
          >
            <i className="ti ti-refresh" /> Create revision
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={deleteMut.isPending}
            onClick={() => {
              if (window.confirm('Delete this order? This cannot be undone.')) {
                deleteMut.mutate();
              }
            }}
          >
            <i className="ti ti-trash" /> {deleteMut.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {order.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL' && (
        <div style={{ marginTop: 16 }}>
          <AdminCounterDecision
            orderId={id}
            customerAmount={
              [...(order.quotations ?? [])].sort((a, b) => b.version - a.version)[0]
                ?.amountCents ?? order.priceCents
            }
            customerNote={
              [...(order.quotations ?? [])].sort((a, b) => b.version - a.version)[0]
                ?.comment
            }
            studioAmount={studioQuotation(order.quotations as QuoteWithLines[] | undefined)?.amountCents}
            canApprove={canApproveCounter}
            approvePending={counterApprove.isPending}
            onApprove={() => counterApprove.mutate()}
            onDone={(next, kind) => {
              invalidate(next);
              setToast(
                kind === 'recounter'
                  ? 'Re-counter sent. Waiting for the customer.'
                  : 'Quote closed as declined by the studio.',
              );
            }}
            onError={setError}
          />
        </div>
      )}

      <QuoteHistory quotations={order.quotations as QuoteWithLines[] | undefined} />

      {(editsQ.data?.edits.length ?? 0) > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-refresh" /> Customer revision
            </span>
          </div>
          {(editsQ.data?.edits ?? []).map((e) => {
            const names = designs
              .filter((d) => (e.designIds ?? []).includes(d.id) || d.id === e.designId)
              .map((d) => d.name);
            return (
            <div
              key={e.id}
              style={{
                padding: '14px 16px',
                borderBottom: '0.5px solid var(--line)',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                alignItems: 'flex-start',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {e.status === 'DONE' ? 'Resolved' : 'Customer asked for a revision'}
                </div>
                <div style={{ marginTop: 8, fontSize: 14, whiteSpace: 'pre-wrap' }}>
                  {e.note || 'No note was added.'}
                </div>
                {names.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--muted)' }}>
                    {names.join(', ')}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                  {dateShort(e.createdAt)}
                  {e.kind === 'PAID' ? ' · Paid revision' : ' · Free'}
                </div>
              </div>
              <span className={e.status === 'DONE' ? 'chip c-done' : 'chip c-review'}>
                {e.status === 'DONE' ? 'Done' : 'Revision requested'}
              </span>
            </div>
            );
          })}
        </div>
      )}

      <div className="od-grid">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-paperclip" /> Customer files &amp; reference
              </span>
            </div>
            <div className="od-files">
              {(order.attachments ?? []).length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>No files uploaded.</div>
              )}
              {(order.attachments ?? []).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="odf"
                  onClick={() => downloadSignedFile(adminAttachmentUrl(order.id, a.id), a.originalName)}
                >
                  <i className="ti ti-file" /> {a.originalName}
                </button>
              ))}
              <label className="odf up">
                <i className="ti ti-cloud-upload" />{' '}
                {refUploading ? 'Uploading…' : 'Upload reference'}
                <input
                  type="file"
                  multiple
                  hidden
                  disabled={refUploading}
                  onChange={(e) => {
                    void uploadReferenceFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <div className="od-line">
              <span className="l">Formats requested</span>
              <span className="v">
                {designs.flatMap((d) => d.requestedFormats ?? []).slice(0, 3).map((f) => (
                  <span key={f} className="fmtchip">
                    {f}
                  </span>
                )) || 'None'}
              </span>
            </div>
            <div className="od-line">
              <span className="l">Placement / size</span>
              <span className="v">
                {order.size ?? (designs.map((d) => d.size).filter(Boolean).join(' · ') || 'None')}
              </span>
            </div>
            <div className="od-line">
              <span className="l">Turnaround</span>
              <span className="v">
                {order.turnaroundLabel ?? 'Not set'}
              </span>
            </div>
            {order.instructions && (
              <div className="od-line">
                <span className="l">Customer note</span>
                <span className="v" style={{ fontWeight: 400, color: 'var(--muted)', maxWidth: '60%', textAlign: 'right' }}>
                  &quot;{order.instructions}&quot;
                </span>
              </div>
            )}
          </div>

          <FormPreferencesDisplay preferences={order.preferences} />

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-layout-list" /> Designs in this order
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {readyCount} ready · {progCount} in progress
              </span>
            </div>
            {designs.length === 0 && (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>No designs yet.</div>
            )}
            {designs.map((d) => {
              const submitted = hasSubmitted(d.id);
              const pending = hasPendingRelease(d.id);
              const hasReleased = filesForDesign(d.id).some((f) => f.releasedAt);
              const published = d.status === 'DELIVERED' || hasReleased;
              const inRevision = designInRevision(d.id);
              const editing = editingIds.includes(d.id) || inRevision;
              const locked = published && !editing;
              const canOpenPublish = canDeliver && !locked && (editing || d.status === 'DONE');
              const markAwaiting = editing && published && !inRevision;
              const nextMark = markAwaiting
                ? { label: 'Mark awaiting', status: 'WAITING' as const }
                : d.status === 'WAITING'
                  ? { label: 'Mark in progress', status: 'IN_PROGRESS' as const }
                  : d.status === 'IN_PROGRESS'
                    ? { label: 'Mark ready', status: 'DONE' as const }
                    : d.status === 'DONE' && !locked
                      ? { label: 'Mark in progress', status: 'IN_PROGRESS' as const }
                      : null;
              return (
                <div key={d.id} className="od-line" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <span className="l" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {nextMark && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        disabled={locked || setDesignStatus.isPending}
                        onClick={() =>
                          setDesignStatus.mutate({
                            designId: d.id,
                            status: nextMark.status,
                          })
                        }
                      >
                        {nextMark.label}
                      </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        disabled={!canOpenPublish}
                        onClick={() => {
                          setPublishFor(d);
                          setPublishFiles([]);
                          setPublishSaved(false);
                        }}
                      >
                        Publish
                      </button>
                      <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
                        {d.name}
                        {d.placement && (
                          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                            {' '}
                            ({d.placement})
                          </span>
                        )}
                      </span>
                    </span>
                    {filesForDesign(d.id).length > 0 && (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {filesForDesign(d.id).length} file
                        {filesForDesign(d.id).length === 1 ? '' : 's'}
                        {pending ? ' · waiting for approval' : ' · delivered'}
                      </span>
                    )}
                  </span>
                  <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className={designStatusChipClass(d.status)}>
                        {pending ? 'Waiting for approval' : designStatusLabel(d.status)}
                      </span>
                      {inRevision && <span className="chip c-review">Revision requested</span>}
                    </span>
                    {canApprove && pending && (
                      <button
                        type="button"
                        className="btn btn-green btn-sm"
                        disabled={deliver.isPending}
                        onClick={() =>
                          deliver.mutate({ release: true, designIds: [d.id], upload: [] })
                        }
                      >
                        Release
                      </button>
                    )}
                    {submitted && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={editing}
                        onClick={() =>
                          setEditingIds((prev) =>
                            prev.includes(d.id) ? prev : [...prev, d.id],
                          )
                        }
                      >
                        Edit
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {(formatReqQ.data?.requests.length ?? 0) > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-file-export" /> Format requests
                </span>
              </div>
              <div className="muted" style={{ padding: '10px 16px 0', fontSize: 12.5 }}>
                Upload the export, then send it. Leave the fee blank to send free.
                Enter a fee to invoice first — the file is held until they pay.
              </div>
              {formatReqQ.data?.requests.map((r) => {
                const picked = formatFiles[r.id] ?? [];
                const open = r.status !== 'DONE' && r.status !== 'CANCELLED';
                const awaitingPay = open && r.invoiceStatus === 'AWAITING' && !!r.invoiceId;
                const chargeCents = feeDollarsToCents(formatPrices[r.id]);
                const willCharge = Number.isFinite(chargeCents) && chargeCents > 0;
                const statusLabel = awaitingPay
                  ? 'Waiting for payment'
                  : r.status === 'IN_PROGRESS'
                    ? 'In progress'
                    : r.status === 'DONE'
                      ? 'Sent'
                      : r.status === 'CANCELLED'
                        ? 'Cancelled'
                        : 'Pending';
                const statusCls = awaitingPay
                  ? 'chip c-wait'
                  : r.status === 'DONE'
                    ? 'chip c-paid'
                    : 'chip c-prog';
                return (
                <div key={r.id} className="od-line" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <span className="l">
                    {r.format}
                    {r.note ? ` · ${r.note}` : ''}
                    {r.priceCents ? ` · ${money(r.priceCents)}` : ''}
                  </span>
                  <span className="v" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className={statusCls}>{statusLabel}</span>
                    {open && r.status === 'PENDING' && !awaitingPay && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={updateFormatReq.isPending || fulfillFormatReq.isPending}
                        onClick={() =>
                          updateFormatReq.mutate({
                            requestId: r.id,
                            status: 'IN_PROGRESS',
                          })
                        }
                      >
                        Start
                      </button>
                    )}
                    {awaitingPay && r.invoiceId && showMoney && (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={formatPayLinkMut.isPending}
                          onClick={() => formatPayLinkMut.mutate(r.invoiceId!)}
                        >
                          Copy pay link
                        </button>
                        <button
                          type="button"
                          className="btn btn-green btn-sm"
                          disabled={formatMarkPaidMut.isPending}
                          onClick={() => formatMarkPaidMut.mutate(r.invoiceId!)}
                        >
                          {formatMarkPaidMut.isPending ? 'Saving…' : 'Mark paid'}
                        </button>
                      </>
                    )}
                    {open && canPublishToCustomer && !awaitingPay && (
                      <>
                        <label className="btn btn-ghost btn-sm" style={{ margin: 0, cursor: 'pointer' }}>
                          <i className="ti ti-paperclip" /> {picked.length ? `${picked.length} file(s)` : 'Choose file'}
                          <input
                            type="file"
                            multiple
                            hidden
                            onChange={(e) => {
                              const next = Array.from(e.target.files ?? []).slice(0, 10);
                              setFormatFiles((prev) => ({ ...prev, [r.id]: next }));
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {showMoney && (
                          <label className="fmt-fee" title="Leave blank to send free">
                            <span>$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={formatPrices[r.id] ?? ''}
                              onChange={(e) =>
                                setFormatPrices((prev) => ({
                                  ...prev,
                                  [r.id]: e.target.value,
                                }))
                              }
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={
                            fulfillFormatReq.isPending || picked.length === 0
                          }
                          onClick={() => {
                            const cents = feeDollarsToCents(formatPrices[r.id]);
                            if (Number.isNaN(cents)) {
                              setError('Enter a valid fee, or leave it blank to send free.');
                              return;
                            }
                            if (cents > 0 && !order?.customerId) {
                              setError('Link a customer before charging for this export.');
                              return;
                            }
                            fulfillFormatReq.mutate({
                              requestId: r.id,
                              files: picked,
                              amountCents: cents > 0 ? cents : undefined,
                            });
                          }}
                        >
                          {fulfillFormatReq.isPending
                            ? willCharge
                              ? 'Invoicing…'
                              : 'Sending…'
                            : willCharge
                              ? 'Invoice customer'
                              : 'Send to customer'}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                );
              })}
            </div>
          )}

          {hasDeliveries && (
            <div className="card role-manager" style={{ marginTop: 14 }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-checkup-list" /> Finished files
                </span>
              </div>
              <div className="pub-files" style={{ padding: '14px 16px' }}>
                {(order.deliveries ?? []).flatMap((d) =>
                  d.files.map((f) => (
                    <SavedPublishFile
                      key={f.id}
                      orderId={order.id}
                      file={f}
                      waiting={!d.releasedAt}
                      canDelete={canDeliver}
                      deleting={removeDeliveryFile.isPending}
                      onDelete={() => removeDeliveryFile.mutate(f.id)}
                    />
                  )),
                )}
              </div>
              {canApprove && pendingBatches.length > 0 && (
                <div style={{ padding: '0 16px 14px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={notifyPortal}
                      onChange={(e) => setNotifyPortal(e.target.checked)}
                    />{' '}
                    Notify customer when released
                  </label>
                  <button
                    type="button"
                    className="btn btn-green btn-sm"
                    disabled={deliver.isPending}
                    onClick={() => deliver.mutate({ release: true, upload: [] })}
                  >
                    <i className="ti ti-send" />{' '}
                    {deliver.isPending ? 'Releasing…' : 'Release all waiting files'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-message" /> Messages on this order
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={genInvoice.isPending || !order.priceCents || !order.customerId}
                onClick={() => genInvoice.mutate()}
              >
                <i className="ti ti-file-invoice" />{' '}
                {genInvoice.isPending ? 'Creating…' : 'Generate invoice'}
              </button>
            </div>
            <div className="thread">
              {messages.map((m) => (
                <div key={m.id} className={`tmsg ${m.direction === 'OUTBOUND' ? 'me' : 'them'}`}>
                  {m.body && m.body !== '(attachment)' ? <div>{m.body}</div> : null}
                  <MessageAttachments attachments={m.attachments} />
                  <div className="tm">
                    {m.direction === 'OUTBOUND' ? 'You' : customerName(order)} · {relativeTime(m.createdAt)}
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>No messages on this order yet.</div>
              )}
            </div>
            {canMessageCustomer && msgFiles.length > 0 && (
              <div style={{ padding: '0 14px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {msgFiles.map((f, i) => (
                  <button
                    key={`${f.name}-${i}`}
                    type="button"
                    className="odf"
                    onClick={() => setMsgFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <i className="ti ti-paperclip" /> {f.name} <i className="ti ti-x" />
                  </button>
                ))}
              </div>
            )}
            {canMessageCustomer && (
            <div className="thread-in" style={{ position: 'relative' }}>
              {showTemplates && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 14,
                    right: 14,
                    background: '#fff',
                    border: '0.5px solid var(--line)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                    maxHeight: 200,
                    overflowY: 'auto',
                    zIndex: 10,
                  }}
                >
                  {(templatesQ.data?.templates ?? []).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setMsgDraft((d) => (d ? `${d}\n${t.body}` : t.body));
                        setShowTemplates(false);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{t.title}</div>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="tmpl-btn"
                title="Insert saved reply"
                onClick={() => setShowTemplates((v) => !v)}
              >
                <i className="ti ti-template" />
              </button>
              <label className="tmpl-btn" title="Attach file" style={{ cursor: 'pointer' }}>
                <i className="ti ti-paperclip" />
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    if (list.length) setMsgFiles((prev) => [...prev, ...list].slice(0, 8));
                    e.target.value = '';
                  }}
                />
              </label>
              <input
                value={msgDraft}
                placeholder={`Reply to ${customerName(order)}…`}
                onChange={(e) => setMsgDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    (msgDraft.trim() || msgFiles.length > 0)
                  ) {
                    sendMsg.mutate({ body: msgDraft.trim(), files: msgFiles });
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={(!msgDraft.trim() && msgFiles.length === 0) || sendMsg.isPending}
                onClick={() =>
                  (msgDraft.trim() || msgFiles.length > 0) &&
                  sendMsg.mutate({ body: msgDraft.trim(), files: msgFiles })
                }
              >
                <i className="ti ti-send" />
              </button>
            </div>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-user-star" /> Designer
              </span>
              {!assigned && <span className="chip c-prog">Unassigned</span>}
            </div>
            <div style={{ padding: '12px 16px 14px' }}>
              {!assigned && (
                <div className="note amber" style={{ margin: '0 0 10px' }}>
                  <i className="ti ti-alert-circle" /> New order. Assign a designer to start.
                </div>
              )}
              {canAssignDesigner ? (
                <>
              <select
                className="stat-select"
                style={{ width: '100%', marginBottom: 9 }}
                value={designerId}
                onChange={(e) => setDesignerId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {designers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.firstName ?? d.email} ({d.skills.join(', ') || 'Designer'})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={
                  assign.isPending ||
                  designerId === (order.assignedDesignerId ?? '')
                }
                onClick={() => assign.mutate()}
              >
                <i className="ti ti-user-check" />{' '}
                {designerId
                  ? 'Assign. Moves to their queue.'
                  : 'Move back to unassigned'}
              </button>
                </>
              ) : null}
              {assigned && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                  Assigned to {assigned.firstName ?? assigned.email}
                </div>
              )}
            </div>
          </div>

          {showMoney && (
          <div className="card role-money" style={{ marginTop: 12 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-cash" /> Price &amp; payment
              </span>
            </div>
            <div className="od-line">
              <span className="l">Price</span>
              <span className="v">{money(order.priceCents)}</span>
            </div>
            <div className="od-line">
              <span className="l">Payment</span>
              <span className="v">
                <span className={payment.cls}>{payment.text}</span>
              </span>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!hasPaidInvoice && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ justifyContent: 'center' }}
                    disabled={genInvoice.isPending || !order.priceCents || !order.customerId}
                    onClick={() => genInvoice.mutate()}
                  >
                    <i className="ti ti-file-invoice" />{' '}
                    {genInvoice.isPending ? 'Creating…' : 'Create / edit invoice'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ justifyContent: 'center' }}
                    disabled={payLinkMut.isPending || !order.priceCents || !order.customerId}
                    onClick={() => payLinkMut.mutate()}
                  >
                    <i className="ti ti-credit-card" />{' '}
                    {payLinkMut.isPending ? 'Creating link…' : 'Copy card pay link'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ justifyContent: 'center' }}
                    disabled={markPaid.isPending || !order.priceCents}
                    onClick={() => markPaid.mutate()}
                  >
                    <i className="ti ti-check" /> Mark payment received
                  </button>
                </>
              )}
              {canRefund && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'center', color: 'var(--maroon)' }}
                onClick={() => setShowRefund(true)}
              >
                <i className="ti ti-arrow-back-up" /> Refund
              </button>
              )}
            </div>
          </div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-notes" /> Internal notes
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>only your team</span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <textarea
                className="notes-box"
                placeholder="Notes about this order…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                disabled={
                  saveNotes.isPending || notes === (order.internalNotes ?? '')
                }
                onClick={() => saveNotes.mutate(notes)}
              >
                <i className="ti ti-device-floppy" />{' '}
                {saveNotes.isPending ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-history" /> Activity
              </span>
            </div>
            <div className="actlog">
              {activity.length === 0 && (
                <div style={{ padding: 12, color: 'var(--muted)', fontSize: 12 }}>No activity yet.</div>
              )}
              {activity.map((a) => {
                const meta =
                  a.meta && typeof a.meta === 'object'
                    ? (a.meta as { note?: string; source?: string })
                    : typeof a.meta === 'string'
                      ? (() => {
                          try {
                            return JSON.parse(a.meta) as { note?: string; source?: string };
                          } catch {
                            return {};
                          }
                        })()
                      : {};
                const label =
                  a.event === 'edit_requested'
                    ? meta.source === 'client'
                      ? 'Customer asked for a revision'
                      : 'Revision started'
                    : a.event === 'edit_done'
                      ? 'Revision marked done'
                      : a.event.replace(/_/g, ' ');
                return (
                  <div key={a.id} className="actrow">
                    <div className="ai">
                      <i className="ti ti-point" />
                    </div>
                    <div>
                      <div>{label}</div>
                      {meta.note ? (
                        <div style={{ marginTop: 4, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
                          {meta.note}
                        </div>
                      ) : null}
                      <div className="at">{dateShort(a.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {publishFor && (
        <div
          className="overlay open"
          onClick={() => {
            if (deliver.isPending) return;
            setPublishFor(null);
            setPublishFiles([]);
            setPublishSaved(false);
          }}
        >
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <span>Publish {publishFor.name}</span>
              <button
                type="button"
                className="modal-x"
                onClick={() => {
                  setPublishFor(null);
                  setPublishFiles([]);
                  setPublishSaved(false);
                }}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="modal-b">
              <p className="muted" style={{ marginTop: 0 }}>
                {isDesigner
                  ? 'Attach up to 10 files, click Save, then publish to the customer or send to admin for approval.'
                  : showSendForApproval
                    ? 'Attach up to 10 files, click Save, then send them to admin for approval.'
                    : 'Attach up to 10 files, click Save, then publish them to the customer.'}
              </p>
              <label className="odf up" style={{ marginBottom: 12, display: 'inline-flex' }}>
                <i className="ti ti-cloud-upload" /> Choose files
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const added = Array.from(e.target.files ?? []);
                    setPublishFiles((prev) => {
                      const next = [...prev];
                      for (const f of added) {
                        if (next.length >= 10) break;
                        const dup = next.some(
                          (x) =>
                            x.name === f.name &&
                            x.size === f.size &&
                            x.lastModified === f.lastModified,
                        );
                        if (!dup) next.push(f);
                      }
                      return next;
                    });
                    setPublishSaved(false);
                    e.target.value = '';
                  }}
                />
              </label>
              {publishFiles.length > 0 && (
                <>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    {publishFiles.length} of 10 files — click the trash on a picture to remove it
                  </div>
                  <LocalPublishFiles
                    files={publishFiles}
                    disabled={deliver.isPending}
                    onRemove={(index) => {
                      setPublishFiles((prev) => prev.filter((_, i) => i !== index));
                      setPublishSaved(false);
                    }}
                  />
                </>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={deliver.isPending}
                  onClick={() => {
                    setPublishFor(null);
                    setPublishFiles([]);
                    setPublishSaved(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={deliver.isPending || publishFiles.length === 0 || publishSaved}
                  onClick={() => setPublishSaved(true)}
                >
                  {publishSaved ? 'Saved' : 'Save'}
                </button>
                {showSendForApproval && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={deliver.isPending || !publishSaved || publishFiles.length === 0}
                    onClick={() =>
                      deliver.mutate({
                        release: false,
                        designIds: [publishFor.id],
                        upload: publishFiles,
                      })
                    }
                  >
                    {deliver.isPending ? 'Sending…' : 'Send for approval'}
                  </button>
                )}
                {canPublishToCustomer && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={deliver.isPending || !publishSaved || publishFiles.length === 0}
                    onClick={() =>
                      deliver.mutate({
                        release: true,
                        designIds: [publishFor.id],
                        upload: publishFiles,
                      })
                    }
                  >
                    {deliver.isPending ? 'Publishing…' : 'Publish to customer'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showRevision && (
        <RevisionModal
          orderRef={order.humanRef ?? order.id.slice(0, 6)}
          defaultDesignerId={order.assignedDesignerId ?? ''}
          designers={designers}
          designs={designs}
          onClose={() => setShowRevision(false)}
          onSubmit={async (data) => {
            await createAdminEdit(id, data);
            setShowRevision(false);
            setToast('Revision started on this order.');
            invalidate();
            void qc.invalidateQueries({ queryKey: ['admin-order-edits', id] });
          }}
        />
      )}

      {showRefund && (
        <RefundModal
          orderId={id}
          orderRef={order.humanRef ?? order.id.slice(0, 6)}
          priceCents={order.priceCents}
          onClose={() => setShowRefund(false)}
          onDone={() => {
            setShowRefund(false);
            setToast('Refund issued.');
            invalidate();
          }}
        />
      )}

      {toast && (
        <div className="toast show">
          <i className="ti ti-circle-check" /> {toast}
        </div>
      )}
    </div>
  );
}

function RevisionModal({
  orderRef,
  defaultDesignerId,
  designers,
  designs,
  onClose,
  onSubmit,
}: {
  orderRef: string;
  defaultDesignerId: string;
  designers: Array<{ id: string; firstName: string | null; email: string; skills: string[] }>;
  designs: Design[];
  onClose: () => void;
  onSubmit: (data: {
    note: string;
    kind: EditKind;
    priceCents?: number | null;
    designIds?: string[];
    assignedDesignerId?: string | null;
  }) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<EditKind>('FREE');
  const [price, setPrice] = useState('');
  const [designerId, setDesignerId] = useState(defaultDesignerId);
  const [assignDesigner, setAssignDesigner] = useState(!!defaultDesignerId);
  const [designIds, setDesignIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const showPicker = designs.length > 1;

  const handleSubmit = async () => {
    if (!note.trim()) {
      setError('Describe what needs to change.');
      return;
    }
    if (showPicker && designIds.length === 0) {
      setError('Pick which designs need a revision.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({
        note: note.trim(),
        kind,
        priceCents:
          kind === 'PAID' && price ? Math.round(Number(price) * 100) : kind === 'PAID' ? 0 : null,
        designIds: showPicker ? designIds : designs[0] ? [designs[0].id] : [],
        assignedDesignerId: assignDesigner && designerId ? designerId : null,
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Create revision #{orderRef}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="note" style={{ marginTop: 0, marginBottom: 12 }}>
            <i className="ti ti-info-circle" /> Stays on this order. The customer keeps the old files
            until you publish new ones.
          </div>
          {showPicker && (
            <div className="ff">
              <label>Which designs</label>
              {designs.map((d) => (
                <label
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    marginBottom: 6,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={designIds.includes(d.id)}
                    onChange={() =>
                      setDesignIds((prev) =>
                        prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                      )
                    }
                  />
                  {d.name}
                  {d.placement ? ` (${d.placement})` : ''}
                </label>
              ))}
            </div>
          )}
          <div className="ff">
            <label>What needs to change</label>
            <textarea
              placeholder='e.g. resize eagle to 3", make text bolder for stitching'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              className={`btn btn-sm ${kind === 'FREE' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setKind('FREE')}
            >
              Free revision
            </button>
            <button
              type="button"
              className={`btn btn-sm ${kind === 'PAID' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setKind('PAID')}
            >
              Paid revision
            </button>
          </div>
          {kind === 'PAID' && (
            <div className="ff">
              <label>Revision price. Payment link goes out first.</label>
              <input
                type="number"
                step="0.01"
                placeholder="$"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          )}
          {designers.length > 0 && (
            <>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12.5,
                  marginBottom: 8,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={assignDesigner}
                  onChange={(e) => setAssignDesigner(e.target.checked)}
                />
                Assign to designer
              </label>
              {assignDesigner && (
                <select
                  className="stat-select"
                  style={{ width: '100%', marginBottom: 12 }}
                  value={designerId}
                  onChange={(e) => setDesignerId(e.target.value)}
                >
                  <option value="">Choose designer</option>
                  {designers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.firstName ?? d.email}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={pending}
            onClick={() => void handleSubmit()}
          >
            <i className="ti ti-refresh" /> {pending ? 'Creating…' : 'Create revision'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RefundModal({
  orderId,
  orderRef,
  priceCents,
  onClose,
  onDone,
}: {
  orderId: string;
  orderRef: string;
  priceCents: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const defaultAmount = priceCents ? (priceCents / 100).toFixed(2) : '';
  const [amount, setAmount] = useState(defaultAmount);
  const [to, setTo] = useState<RefundTo>('STORE_CREDIT');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      refundOrder(orderId, {
        amountCents: Math.round(Number(amount) * 100),
        to,
        reason: reason || undefined,
      }),
    onSuccess: onDone,
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Refund #{orderRef}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>Amount</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="ff">
            <label>Refund to</label>
            <select value={to} onChange={(e) => setTo(e.target.value as RefundTo)}>
              <option value="CARD">Card</option>
              <option value="STORE_CREDIT">Store credit</option>
            </select>
          </div>
          <div className="ff">
            <label>Reason</label>
            <input
              placeholder="e.g. cancelled before work started"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={mut.isPending || !(Number(amount) > 0)}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Processing…' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  );
}
