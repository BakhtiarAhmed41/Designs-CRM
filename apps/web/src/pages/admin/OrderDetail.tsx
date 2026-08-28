import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminAttachmentUrl,
  adminDeliveryFileUrl,
  adminUpdateStatus,
  adminUploadAttachments,
  approveCounter,
  deleteAdminOrder,
  deliverOrder,
  getAdminOrder,
  listAdminFormatRequests,
  rejectCounter,
  resendOrderFiles,
  updateAdminFormatRequest,
  updateOrderNotes,
} from '@/lib/orders';
import { applyOrderChange, cacheOrder, invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { createAdminEdit, getOrderActivity, type EditKind } from '@/lib/edits';
import {
  getAdminConversation,
  listAdminConversations,
  listMessageTemplates,
  sendAdminMessage,
  createAdminConversation,
} from '@/lib/messaging';
import { createInvoice, listInvoices, payInvoice, refundOrder, type RefundTo } from '@/lib/billing';
import { assignOrder, listTeam, unassignOrder } from '@/lib/team';
import { updateDesign, type Design, type DesignStatus } from '@/lib/designs';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { money, dateShort } from '@/lib/format';
import { FormPreferencesDisplay } from '@/components/FormPreferencesDisplay';
import { MessageAttachments } from '@/components/MessageAttachments';
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

function customerName(order: AdminOrderFull) {
  const c = order.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function designChip(status: DesignStatus) {
  switch (status) {
    case 'DELIVERED':
    case 'DONE':
      return 'chip c-review';
    case 'IN_PROGRESS':
      return 'chip c-prog';
    default:
      return 'chip c-wait';
  }
}

function designStatusLabel(status: DesignStatus) {
  switch (status) {
    case 'DONE':
    case 'DELIVERED':
      return 'Ready';
    case 'IN_PROGRESS':
      return 'In progress';
    default:
      return 'Waiting';
  }
}

function payBadge(status: OrderStatus, priceCents: number | null) {
  if (status === 'PENDING_PAYMENT') return { cls: 'pay-badge pay-unpaid', text: 'Awaiting payment' };
  if (priceCents && priceCents > 0 && status !== 'COMPLETED') return { cls: 'pay-badge pay-deposit', text: 'Deposit due' };
  if (priceCents) return { cls: 'pay-badge pay-paid', text: 'Paid in full' };
  return { cls: 'pay-badge pay-unpaid', text: 'Not priced' };
}

function relativeTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  const [files, setFiles] = useState<File[]>([]);
  const [msgDraft, setMsgDraft] = useState('');
  const [msgFiles, setMsgFiles] = useState<File[]>([]);
  const [refUploading, setRefUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [designerId, setDesignerId] = useState('');
  const [notifyPortal, setNotifyPortal] = useState(true);
  const [deliverByEmail, setDeliverByEmail] = useState(false);
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>([]);
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

  useEffect(() => {
    const designs = order?.designs ?? [];
    setSelectedDesignIds(designs.map((d) => d.id));
  }, [order?.id, order?.designs?.length]);

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
    mutationFn: (opts: { release: boolean }) => {
      const designs = order?.designs ?? [];
      const allSelected =
        designs.length === 0 || selectedDesignIds.length === designs.length;
      return deliverOrder(id, files, {
        deliveredVia: deliverByEmail ? 'EMAIL' : 'PORTAL',
        designIds: selectedDesignIds.length ? selectedDesignIds : undefined,
        notifyEmail: opts.release && notifyPortal,
        notifySms: opts.release && notifyPortal,
        complete: opts.release && allSelected,
        release: opts.release,
      });
    },
    onSuccess: (res, opts) => {
      setFiles([]);
      if (!opts.release) {
        setToast('Submitted for approval. The customer cannot see files until you release them.');
      } else if (res.partial) {
        setToast('Partial release. Order still in progress.');
      } else {
        setToast('Files released. The customer can download them from Orders and Files.');
      }
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

  const counterReject = useMutation({
    mutationFn: () => rejectCounter(id),
    onSuccess: (res) => {
      setToast('Counter rejected.');
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

  useEffect(() => {
    if (!order || notes === (order.internalNotes ?? '')) return;
    const t = window.setTimeout(() => {
      saveNotes.mutate(notes);
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce notes only
  }, [notes]);

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
    onSuccess: () => invalidate(),
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
  const payment = payBadge(order.status, order.priceCents);
  const assigned = designers.find((d) => d.id === order.assignedDesignerId);
  const canDeliver = order.status === 'IN_PROGRESS' || order.status === 'READY_TO_SEND';
  const messages = threadQ.data?.conversation.messages ?? [];
  const activity = activityQ.data?.activity ?? [];
  const hasDeliveries = (order.deliveries ?? []).length > 0;
  const hasPaidInvoice = (invoicesQ.data?.invoices ?? []).some(
    (inv) => inv.orderId === id && inv.status === 'PAID',
  );
  const canRefund = hasPaidInvoice && order.status !== 'REFUNDED';

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
          <div className="sub">
            {customerName(order)} · {order.serviceType ?? 'Service'} · {designs.length} designs · placed{' '}
            {dateShort(order.createdAt)}
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
        <div className="card" style={{ marginTop: 16, border: '1.5px solid var(--amber)' }}>
          <div className="card-h">
            <span className="ct">
              <i className="ti ti-scale" /> Customer counter offer
            </span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              Latest amount:{' '}
              <b style={{ fontSize: 18, color: 'var(--navy)' }}>
                {money(
                  [...(order.quotations ?? [])].sort(
                    (a, b) => b.version - a.version,
                  )[0]?.amountCents ?? order.priceCents,
                )}
              </b>
            </div>
            {canApproveCounter ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={counterApprove.isPending}
                onClick={() => counterApprove.mutate()}
              >
                <i className="ti ti-check" /> Approve counter
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={counterReject.isPending}
                onClick={() => counterReject.mutate()}
              >
                <i className="ti ti-x" /> Reject counter
              </button>
            </div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                Waiting for an admin to approve or reject this counter.
              </div>
            )}
          </div>
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
            {designs.map((d) => (
              <div key={d.id} className="od-line">
                <span className="l" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={selectedDesignIds.includes(d.id)}
                    onChange={(e) => {
                      setSelectedDesignIds((prev) =>
                        e.target.checked
                          ? prev.includes(d.id)
                            ? prev
                            : [...prev, d.id]
                          : prev.filter((x) => x !== d.id),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() =>
                      setDesignStatus.mutate({
                        designId: d.id,
                        status: d.status === 'DONE' || d.status === 'DELIVERED' ? 'IN_PROGRESS' : 'DONE',
                      })
                    }
                  >
                    {d.status === 'DONE' || d.status === 'DELIVERED' ? 'Mark waiting' : 'Mark ready'}
                  </button>
                  {d.name}
                  {d.placement && (
                    <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({d.placement})</span>
                  )}
                </span>
                <span className="v">
                  <span className={designChip(d.status)}>{designStatusLabel(d.status)}</span>
                </span>
              </div>
            ))}
            <div style={{ padding: '8px 16px 12px', fontSize: 11.5, color: 'var(--muted)' }}>
              <i className="ti ti-info-circle" /> Tick designs to include in the next release. Leave some
              unchecked for a partial delivery.
            </div>
          </div>

          {(formatReqQ.data?.requests.length ?? 0) > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-file-export" /> Format requests
                </span>
              </div>
              {formatReqQ.data?.requests.map((r) => (
                <div key={r.id} className="od-line">
                  <span className="l">
                    {r.format}
                    {r.note ? ` · ${r.note}` : ''}
                  </span>
                  <span className="v" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={r.status === 'DONE' ? 'chip c-paid' : 'chip c-prog'}>
                      {r.status === 'IN_PROGRESS'
                        ? 'In progress'
                        : r.status === 'DONE'
                          ? 'Done'
                          : r.status === 'CANCELLED'
                            ? 'Cancelled'
                            : 'Pending'}
                    </span>
                    {r.status !== 'DONE' && r.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          void updateAdminFormatRequest(
                            r.id,
                            r.status === 'PENDING' ? 'IN_PROGRESS' : 'DONE',
                          ).then(() =>
                            invalidateWorkCaches(qc),
                          )
                        }
                      >
                        {r.status === 'PENDING' ? 'Start' : 'Mark done'}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(canDeliver || hasDeliveries) && (
            <div className="card role-manager" style={{ marginTop: 14 }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-checkup-list" /> Finished files &amp; delivery
                </span>
              </div>
              <div className="od-files">
                {(order.deliveries ?? []).flatMap((d) =>
                  d.files.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="odf"
                      onClick={() =>
                        downloadSignedFile(adminDeliveryFileUrl(order.id, f.id), f.originalName)
                      }
                    >
                      <i
                        className={`ti ${d.releasedAt ? 'ti-check' : 'ti-clock'}`}
                        style={{ color: d.releasedAt ? 'var(--green)' : 'var(--amber)' }}
                      />{' '}
                      {f.originalName}
                      {!d.releasedAt && (
                        <span className="chip c-wait" style={{ marginLeft: 8 }}>
                          Waiting for approval
                        </span>
                      )}
                    </button>
                  )),
                )}
                {canDeliver && (
                <label className="odf up">
                  <i className="ti ti-cloud-upload" /> Upload file
                  <input
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                </label>
                )}
              </div>
              {canDeliver && files.length > 0 && (
                <div style={{ padding: '0 16px', fontSize: 12, color: 'var(--muted)' }}>
                  {files.length} file(s) selected
                </div>
              )}
              {canDeliver && (
              <div style={{ padding: '0 16px 14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={deliverByEmail}
                    onChange={(e) => setDeliverByEmail(e.target.checked)}
                  />{' '}
                  Mark as emailed outside the portal (files still stored here)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={notifyPortal}
                    onChange={(e) => setNotifyPortal(e.target.checked)}
                  />{' '}
                  Notify customer in the portal
                </label>
                {!canApprove && (
                  <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    Submit for approval saves the files for review. The customer sees them only after an admin releases them.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!canApprove && order.status === 'IN_PROGRESS' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={
                        deliver.isPending ||
                        updateStatus.isPending ||
                        (files.length === 0 && !hasDeliveries)
                      }
                      onClick={() => {
                        if (files.length > 0 || hasDeliveries) deliver.mutate({ release: false });
                        else updateStatus.mutate('READY_TO_SEND');
                      }}
                    >
                      <i className="ti ti-checkup-list" /> Submit for approval
                    </button>
                  )}
                  {order.status === 'READY_TO_SEND' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate('IN_PROGRESS')}
                    >
                      <i className="ti ti-arrow-back" /> Send back
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-green btn-sm"
                    disabled={
                      deliver.isPending || (files.length === 0 && !hasDeliveries)
                    }
                    onClick={() => deliver.mutate({ release: true })}
                  >
                    <i className="ti ti-send" />{' '}
                    {deliver.isPending ? 'Uploading…' : 'Approve & release to customer'}
                  </button>
                </div>
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
            {msgFiles.length > 0 && (
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
                disabled={markPaid.isPending || !order.priceCents}
                onClick={() => markPaid.mutate()}
              >
                <i className="ti ti-check" /> Mark payment received
              </button>
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
              {activity.map((a) => (
                <div key={a.id} className="actrow">
                  <div className="ai">
                    <i className="ti ti-point" />
                  </div>
                  <div>
                    <div>{a.event}</div>
                    <div className="at">{dateShort(a.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showRevision && (
        <RevisionModal
          orderRef={order.humanRef ?? order.id.slice(0, 6)}
          defaultDesignerId={order.assignedDesignerId ?? ''}
          designers={designers}
          onClose={() => setShowRevision(false)}
          onSubmit={async (data) => {
            const res = await createAdminEdit(id, data);
            setShowRevision(false);
            setToast('Revision created.');
            invalidate();
            if (res.edit.revisionOrderId) {
              navigate(`/admin/orders/${res.edit.revisionOrderId}`);
            }
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
  onClose,
  onSubmit,
}: {
  orderRef: string;
  defaultDesignerId: string;
  designers: Array<{ id: string; firstName: string | null; email: string; skills: string[] }>;
  onClose: () => void;
  onSubmit: (data: {
    note: string;
    kind: EditKind;
    priceCents?: number | null;
    assignedDesignerId?: string | null;
  }) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<EditKind>('FREE');
  const [price, setPrice] = useState('');
  const [designerId, setDesignerId] = useState(defaultDesignerId);
  const [assignDesigner, setAssignDesigner] = useState(!!defaultDesignerId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async () => {
    if (!note.trim()) {
      setError('Describe what needs to change.');
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
            <i className="ti ti-info-circle" /> Creates a linked revision order. Original files stay
            untouched.
          </div>
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
              Free edit
            </button>
            <button
              type="button"
              className={`btn btn-sm ${kind === 'PAID' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setKind('PAID')}
            >
              Paid edit
            </button>
          </div>
          {kind === 'PAID' && (
            <div className="ff">
              <label>Edit price. Payment link goes out first.</label>
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
