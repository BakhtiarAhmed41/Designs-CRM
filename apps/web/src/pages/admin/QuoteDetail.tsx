import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminAttachmentUrl,
  adminAcceptQuotation,
  adminRejectOrder,
  adminUploadAttachments,
  approveCounter,
  deleteAdminOrder,
  getAdminOrder,
} from '@/lib/orders';
import { AdminCounterDecision } from '@/components/AdminCounterDecision';
import { QuoteHistory } from '@/components/QuoteHistory';
import {
  createAdminConversation,
  getAdminConversation,
  listAdminConversations,
  sendAdminMessage,
} from '@/lib/messaging';
import { submitQuoteBuilder } from '@/lib/designs';
import { applyOrderChange, invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { getCustomer } from '@/lib/customers';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { money, dateShort, quoteLifecycleChip, friendlyFileName } from '@/lib/format';
import { isAdminRecounter, isStaffCreatedOrder, lineTotal, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import { useDialog } from '@/components/ui/AppDialog';
import { FormPreferencesDisplay } from '@/components/FormPreferencesDisplay';
import { MessageAttachments } from '@/components/MessageAttachments';
import type { Order } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { canSupport } from '@/lib/permissions';

function designsCountLabel(order: Order): string {
  const prefs = order.preferences as { designs?: unknown[] } | null;
  if (Array.isArray(prefs?.designs) && prefs.designs.length > 0) {
    return String(prefs.designs.length);
  }
  const designs = (order as Order & { designs?: unknown[] }).designs;
  if (Array.isArray(designs) && designs.length > 0) {
    return String(designs.length);
  }
  return order.name ? '1+' : 'None';
}

type QuoteLine = {
  name: string;
  note: string;
  price: string;
  attachmentId: string | null;
  attachedName: string | null;
};

function customerName(order: Order) {
  const c = order.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function emptyLine(): QuoteLine {
  return { name: '', note: '', price: '', attachmentId: null, attachedName: null };
}

function linesFromQuote(quote?: QuoteWithLines): QuoteLine[] {
  const rows = quote?.lines ?? [];
  if (rows.length === 0) return [emptyLine()];
  return rows.map((l) => ({
    name: l.name,
    note: l.note ?? '',
    price: l.priceCents != null ? (l.priceCents / 100).toFixed(2) : '',
    attachmentId: l.attachmentId ?? null,
    attachedName: null,
  }));
}

export function AdminQuoteDetail() {
  const dialog = useDialog();
  const { user } = useAuth();
  const canApproveCounter = canSupport(user?.permissions, 'approve', user?.role);
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lines, setLines] = useState<QuoteLine[]>([emptyLine()]);
  const [revising, setRevising] = useState(false);
  const [msgDraft, setMsgDraft] = useState('');
  const [msgFiles, setMsgFiles] = useState<File[]>([]);
  const [refUploading, setRefUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: () => getAdminOrder(id),
    ...freshOnOpen,
  });

  const order = data?.order;
  const attachments = order?.attachments ?? [];

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (order?.type === 'ORDER') {
      navigate(`/admin/orders/${id}`, { replace: true });
    }
  }, [order?.type, id, navigate]);

  const customerId = order?.customerId;

  const customerQ = useQuery({
    queryKey: ['admin-customer-quote', customerId],
    queryFn: () => getCustomer(customerId!),
    enabled: !!customerId,
  });

  const convosQ = useQuery({
    queryKey: ['admin-conversations-quote', id],
    queryFn: () => listAdminConversations({ orderId: id }),
    enabled: !!id,
  });

  const convo = useMemo(
    () => convosQ.data?.conversations.find((c) => c.orderId === id),
    [convosQ.data, id],
  );

  const threadQ = useQuery({
    queryKey: ['admin-conversation', convo?.id],
    queryFn: () => getAdminConversation(convo!.id),
    enabled: !!convo?.id,
    refetchInterval: whenVisible(15_000),
  });

  const totalCents = useMemo(() => {
    let t = 0;
    for (const l of lines) {
      if (l.price) t += Math.round(parseFloat(l.price) * 100) || 0;
    }
    return t;
  }, [lines]);

  function refreshThread() {
    void qc.invalidateQueries({ queryKey: ['admin-conversations-quote', id] });
    void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
    void qc.invalidateQueries({ queryKey: ['admin-conversation'] });
  }

  const sendMsg = useMutation({
    mutationFn: async ({ body, files }: { body: string; files: File[] }) => {
      if (convo) return sendAdminMessage(convo.id, body, files);
      const created = await createAdminConversation({
        orderId: id,
        customerId: order?.customerId ?? null,
        chatType: 'QUOTE',
        subject: order?.humanRef
          ? `Quotation ${order.humanRef} Chat`
          : `Quotation Chat`,
      });
      qc.setQueryData(['admin-conversations-quote', id], (prev: unknown) => {
        const current = prev as { conversations?: typeof created.conversation[] } | undefined;
        const list = current?.conversations ?? [];
        if (list.some((c) => c.id === created.conversation.id)) return prev;
        return { ...(current ?? {}), conversations: [created.conversation, ...list] };
      });
      return sendAdminMessage(created.conversation.id, body, files);
    },
    onSuccess: (res) => {
      setMsgDraft('');
      setMsgFiles([]);
      qc.setQueryData(['admin-conversation', res.conversation.id], (prev: unknown) => {
        const current = prev as { conversation?: { id: string; messages?: unknown[] } } | undefined;
        if (current?.conversation) {
          const messages = current.conversation.messages ?? [];
          return {
            conversation: {
              ...current.conversation,
              ...res.conversation,
              messages: [...messages, res.message],
            },
          };
        }
        return {
          conversation: {
            ...res.conversation,
            messages: [res.message],
          },
        };
      });
      refreshThread();
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
      void invalidateWorkCaches(qc);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRefUploading(false);
    }
  }

  const declineMut = useMutation({
    mutationFn: () =>
      adminRejectOrder(id, { reason: 'Declined by staff', status: 'REJECTED' }),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      navigate('/admin/quotes');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteAdminOrder(id),
    onSuccess: () => {
      void invalidateWorkCaches(qc);
      navigate('/admin/quotes');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const sendQuote = useMutation({
    mutationFn: async () =>
      submitQuoteBuilder(id, {
        lines: lines
          .filter((l) => l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            note: l.note.trim() || undefined,
            attachmentId: l.attachmentId,
            priceCents: l.price ? Math.round(parseFloat(l.price) * 100) : undefined,
          })),
      }),
    onSuccess: (res) => {
      setRevising(false);
      setToast(revising ? 'Revised quote sent. The customer will be notified.' : 'Quote sent. Waiting for the customer.');
      void applyOrderChange(qc, res.order);
      refreshThread();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const acceptAsAdmin = useMutation({
    mutationFn: () => adminAcceptQuotation(id),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      navigate(`/admin/orders/${id}`);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const counterApprove = useMutation({
    mutationFn: () => approveCounter(id),
    onSuccess: (res) => {
      void applyOrderChange(qc, res.order);
      navigate(`/admin/orders/${id}`);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  if (isLoading) return <div className="empty-state"><div className="empty-state-title">Loading quote…</div></div>;
  if (isError || !order) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">{isError ? 'Could not load this quote' : 'Quote not found'}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (order.type === 'ORDER') {
    return <div style={{ padding: 16, color: 'var(--muted)' }}>Converted to order. Redirecting…</div>;
  }

  const customer = customerQ.data?.customer;
  const messages = threadQ.data?.conversation.messages ?? [];
  const awaitingCounter = order.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL';
  const needsPrice =
    order.status === 'WAITING_FOR_QUOTATION' || order.status === 'CREATED';
  const alreadyPriced = order.status === 'QUOTATION_PROVIDED';
  const declined =
    order.status === 'REJECTED' ||
    order.status === 'CLIENT_REJECTED_QUOTATION' ||
    order.status === 'CANCELLED';
  const showBuilder = needsPrice || revising;
  const quotations = (order.quotations ?? []) as QuoteWithLines[];
  const statusChip = quoteLifecycleChip(order.status, 'admin', {
    partiallyAccepted: order.partiallyAccepted,
    adminRecounter: isAdminRecounter(quotations),
  });
  const studioQuote = studioQuotation(quotations);
  const latestQuote = [...quotations].sort((a, b) => b.version - a.version)[0];
  const studioLines = studioQuote?.lines ?? [];

  function startRevise() {
    setLines(linesFromQuote(studioQuote));
    setRevising(true);
  }

  return (
    <div>
      <div className="ph">
        <div>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="crumb"><Link to="/admin/quotes">Quotes</Link></span>
            <span className="crumb">
              <i className="ti ti-chevron-right" aria-hidden />
              <span>Q-{order.humanRef ?? order.id.slice(0, 6)}</span>
            </span>
          </nav>
          <div>
            <h1>
              {order.name ?? 'Quote request'}
            </h1>
            <div className="sub">
              {statusChip.label} · requested {dateShort(order.createdAt)}
              {isStaffCreatedOrder(order) ? ' · Created by admin' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={statusChip.cls}>{statusChip.label}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
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
            <i className="ti ti-trash" /> Delete
          </button>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {toast && (
        <div className="note" style={{ marginBottom: 12 }}>
          <i className="ti ti-circle-check" /> {toast}
        </div>
      )}

      <div className="ws">
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-clipboard-text" /> What the customer wants
              </span>
            </div>
            <div className="od-line">
              <span className="l">Service</span>
              <span className="v">{order.serviceType ?? 'None'}</span>
            </div>
            <div className="od-line">
              <span className="l">Designs</span>
              <span className="v">{designsCountLabel(order)}</span>
            </div>
            <div className="od-line">
              <span className="l">Sizes</span>
              <span className="v">{order.size ?? 'None'}</span>
            </div>
            <div className="od-line">
              <span className="l">Notes from customer</span>
              <span className="v" style={{ fontWeight: 400 }}>
                {order.instructions ? `"${order.instructions}"` : 'None'}
              </span>
            </div>
          </div>

          <FormPreferencesDisplay preferences={order.preferences} />

          <div className="card">
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-photo" /> Customer&apos;s artwork
              </span>
            </div>
            <div className="card-b" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {attachments.length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>No artwork uploaded.</span>
              )}
              {attachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="odf"
                  style={{ cursor: 'pointer' }}
                  title={a.originalName}
                  onClick={() => downloadSignedFile(adminAttachmentUrl(order.id, a.id), a.originalName)}
                >
                  <i className="ti ti-photo" style={{ color: 'var(--navy)' }} />
                  <span className="odf-name">{friendlyFileName(a.originalName)}</span>
                </button>
              ))}
              <label className="odf up">
                <i className="ti ti-cloud-upload" />{' '}
                {refUploading ? 'Uploading…' : 'Upload artwork'}
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
          </div>

          <div className="card">
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-message" /> Messages on this quote
              </span>
            </div>
            <div className="thread">
              {messages.map((m) => (
                <div key={m.id} className={`tmsg ${m.direction === 'OUTBOUND' ? 'me' : 'them'}`}>
                  {m.body && m.body !== '(attachment)' ? <div>{m.body}</div> : null}
                  <MessageAttachments attachments={m.attachments} />
                  <div className="tm">
                    {m.direction === 'OUTBOUND' ? 'You' : customerName(order)} · {dateShort(m.createdAt)}
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>No messages yet.</div>
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
            <div className="thread-in">
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
                placeholder="Reply. Ask a question before pricing if you need to…"
                onChange={(e) => setMsgDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (msgDraft.trim() || msgFiles.length > 0)) {
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
          {awaitingCounter ? (
            <AdminCounterDecision
              orderId={id}
              customerAmount={latestQuote?.amountCents ?? order.priceCents}
              customerNote={latestQuote?.comment}
              studioAmount={studioQuote?.amountCents}
              canApprove={canApproveCounter}
              approvePending={counterApprove.isPending}
              onApprove={() => counterApprove.mutate()}
              onDone={(next, kind) => {
                void applyOrderChange(qc, next);
                setToast(
                  kind === 'recounter'
                    ? 'Re-counter sent. Waiting for the customer.'
                    : 'Quote closed as declined by the studio.',
                );
              }}
              onError={setError}
            />
          ) : showBuilder ? (
            <div className="card" style={{ border: '1.5px solid var(--navy)' }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-currency-dollar" /> {revising ? 'Revise the quote' : 'Build the quote. Price each design.'}
                </span>
              </div>
              <div className="card-b">
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--faint)',
                    textTransform: 'uppercase',
                    letterSpacing: '.4px',
                    marginBottom: 6,
                  }}
                >
                  Quote lines
                </div>

                {lines.map((line, idx) => (
                  <div key={idx} style={{ marginBottom: 10, borderBottom: '0.5px solid var(--line)', paddingBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input
                        placeholder="Line name"
                        value={line.name}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, name: e.target.value } : l)),
                          )
                        }
                        style={{
                          flex: 1,
                          border: '0.5px solid var(--line)',
                          borderRadius: 8,
                          padding: '8px 10px',
                          fontSize: 12,
                          fontFamily: 'inherit',
                        }}
                      />
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <i className="ti ti-trash" /> Remove
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        placeholder="Price"
                        value={line.price}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, price: e.target.value } : l)),
                          )
                        }
                        style={{
                          flex: 1,
                          border: '0.5px solid var(--line)',
                          borderRadius: 8,
                          padding: '8px 10px',
                          fontSize: 12,
                          fontFamily: 'inherit',
                        }}
                      />
                    </div>
                    <select
                      value={line.attachmentId ?? ''}
                      onChange={(e) => {
                        const attachmentId = e.target.value || null;
                        const attachedName =
                          attachments.find((a) => a.id === attachmentId)?.originalName ?? null;
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, attachmentId, attachedName } : l,
                          ),
                        );
                      }}
                      style={{
                        width: '100%',
                        marginTop: 6,
                        border: '0.5px solid var(--line)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        fontSize: 12,
                        fontFamily: 'inherit',
                      }}
                    >
                      <option value="">Attach a customer file (optional)</option>
                      {attachments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {friendlyFileName(a.originalName)}
                        </option>
                      ))}
                    </select>
                    {line.attachedName && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        Attached: {friendlyFileName(line.attachedName)}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'center', margin: '8px 0 12px' }}
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  <i className="ti ti-plus" /> Add line
                </button>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid var(--line)',
                    paddingTop: 10,
                    marginBottom: 12,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
                  <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--navy)' }}>
                    {money(totalCents)}
                  </span>
                </div>

                <div className="note" style={{ margin: '0 0 12px' }}>
                  <i className="ti ti-info-circle" /> Customer can accept or reject each line. They pay only for what
                  they keep.
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={sendQuote.isPending || !lines.some((l) => l.name.trim())}
                  onClick={() => sendQuote.mutate()}
                >
                  <i className="ti ti-send" /> {sendQuote.isPending ? 'Sending…' : revising ? 'Send revised quote' : 'Send quote for per-design approval'}
                </button>
                {revising && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    onClick={() => setRevising(false)}
                  >
                    Cancel revise
                  </button>
                )}
                {!revising && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    disabled={declineMut.isPending}
                    onClick={() => declineMut.mutate()}
                  >
                    <i className="ti ti-x" /> {declineMut.isPending ? 'Declining…' : 'Decline this request'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="card" style={{ border: '1.5px solid var(--navy)' }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-circle-check" /> {declined ? 'Quote closed' : isStaffCreatedOrder(order) ? 'Priced - customer or admin can approve' : 'Priced - awaiting customer'}
                </span>
              </div>
              <div className="card-b">
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6, textAlign: 'center' }}>
                  Quoted total
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--navy)', marginBottom: 12, textAlign: 'center' }}>
                  {money(studioQuote?.amountCents ?? order.priceCents)}
                </div>
                {studioLines.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    {studioLines.map((l) => (
                      <div
                        key={l.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '6px 0',
                          borderBottom: '0.5px solid var(--line)',
                          fontSize: 13,
                        }}
                      >
                        <span>{l.name}</span>
                        <span>{money(lineTotal(l))}</span>
                      </div>
                    ))}
                  </div>
                )}
                {alreadyPriced && isStaffCreatedOrder(order) && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
                    disabled={acceptAsAdmin.isPending}
                    onClick={() => acceptAsAdmin.mutate()}
                  >
                    <i className="ti ti-check" />
                    {acceptAsAdmin.isPending ? 'Approving…' : 'Approve quote'}
                  </button>
                )}
                {(alreadyPriced || declined) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={startRevise}
                  >
                    <i className="ti ti-pencil" /> Revise quote
                  </button>
                )}
                {!declined && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    disabled={declineMut.isPending}
                    onClick={() => declineMut.mutate()}
                  >
                    <i className="ti ti-x" /> {declineMut.isPending ? 'Declining…' : 'Decline this request'}
                  </button>
                )}
              </div>
            </div>
          )}

          <QuoteHistory quotations={quotations} />

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-user" /> Customer
              </span>
            </div>
            <div className="od-line">
              <span className="l">Name</span>
              <span className="v">{customer?.name ?? customerName(order)}</span>
            </div>
            <div className="od-line">
              <span className="l">Past orders</span>
              <span className="v">
                {customer?.ordersCount ?? 0} · {money(customer?.ltvCents ?? 0)} lifetime
              </span>
            </div>
            <div className="od-line">
              <span className="l">Account</span>
              <span className="v">{customer?.accountType?.replace('_', ' ') ?? 'None'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
