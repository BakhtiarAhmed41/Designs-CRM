import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminAttachmentUrl,
  adminRejectOrder,
  approveCounter,
  getAdminOrder,
  rejectCounter,
} from '@/lib/orders';
import {
  createAdminConversation,
  getAdminConversation,
  listAdminConversations,
  sendAdminMessage,
} from '@/lib/messaging';
import { submitQuoteBuilder } from '@/lib/designs';
import { getCustomer } from '@/lib/customers';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { money, dateShort } from '@/lib/format';
import { FormPreferencesDisplay } from '@/components/FormPreferencesDisplay';
import type { Order } from '@/lib/types';

function designsCountLabel(order: Order): string {
  const prefs = order.preferences as { designs?: unknown[] } | null;
  if (Array.isArray(prefs?.designs) && prefs.designs.length > 0) {
    return String(prefs.designs.length);
  }
  const designs = (order as Order & { designs?: unknown[] }).designs;
  if (Array.isArray(designs) && designs.length > 0) {
    return String(designs.length);
  }
  return order.name ? '1+' : '—';
}

type QuoteLine = {
  name: string;
  note: string;
  price: string;
  attachedFile: string | null;
};

function customerName(order: Order) {
  const c = order.client;
  if (!c) return 'Customer';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Customer';
}

function emptyLine(): QuoteLine {
  return { name: '', note: '', price: '', attachedFile: null };
}

export function AdminQuoteDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lines, setLines] = useState<QuoteLine[]>([emptyLine()]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [msgDraft, setMsgDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: () => getAdminOrder(id),
  });

  const order = data?.order;
  const attachments = order?.attachments ?? [];

  const customerId = order?.customerId;

  const customerQ = useQuery({
    queryKey: ['admin-customer-quote', customerId],
    queryFn: () => getCustomer(customerId!),
    enabled: !!customerId,
  });

  const convosQ = useQuery({
    queryKey: ['admin-conversations-quote', id],
    queryFn: () => listAdminConversations(),
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
    refetchInterval: 15_000,
  });

  const totalCents = useMemo(() => {
    let t = 0;
    for (const l of lines) {
      if (l.price) t += Math.round(parseFloat(l.price) * 100) || 0;
    }
    return t;
  }, [lines]);

  const sendMsg = useMutation({
    mutationFn: async (body: string) => {
      if (convo) return sendAdminMessage(convo.id, body);
      const created = await createAdminConversation({
        orderId: id,
        customerId: order?.customerId ?? null,
        subject: order?.name ?? `Quote Q-${order?.humanRef ?? id.slice(0, 6)}`,
      });
      return sendAdminMessage(created.conversation.id, body);
    },
    onSuccess: () => {
      setMsgDraft('');
      qc.invalidateQueries({ queryKey: ['admin-conversation'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const declineMut = useMutation({
    mutationFn: () =>
      adminRejectOrder(id, { reason: 'Declined by staff', status: 'REJECTED' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-quotes'] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      navigate('/admin/quotes');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const sendQuote = useMutation({
    mutationFn: () =>
      submitQuoteBuilder(id, {
        lines: lines
          .filter((l) => l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            note: l.note.trim() || l.attachedFile || undefined,
            priceCents: l.price ? Math.round(parseFloat(l.price) * 100) : undefined,
          })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-order', id] });
      qc.invalidateQueries({ queryKey: ['admin-quotes'] });
      navigate('/admin/quotes');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const counterApprove = useMutation({
    mutationFn: () => approveCounter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-order', id] });
      qc.invalidateQueries({ queryKey: ['admin-quotes'] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const counterReject = useMutation({
    mutationFn: () => rejectCounter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-order', id] });
      qc.invalidateQueries({ queryKey: ['admin-quotes'] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  if (isLoading) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>;
  if (!order) return <div style={{ padding: 16, color: 'var(--muted)' }}>Quote not found.</div>;

  const customer = customerQ.data?.customer;
  const messages = threadQ.data?.conversation.messages ?? [];
  const awaitingCounter = order.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL';
  const needsPrice = order.status === 'WAITING_FOR_QUOTATION';
  const latestQuote = [...(order.quotations ?? [])].sort(
    (a, b) => b.version - a.version,
  )[0];

  return (
    <div>
      <div className="ph">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/admin/quotes" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
            <i className="ti ti-arrow-left" /> Quotes
          </Link>
          <div>
            <h1 style={{ fontSize: 18 }}>
              Q-{order.humanRef ?? order.id.slice(0, 6)} · {order.name ?? 'Quote request'}
            </h1>
            <div className="sub">
              {awaitingCounter
                ? 'Customer countered — decide'
                : needsPrice
                  ? 'Waiting for your price'
                  : 'Quote sent'}{' '}
              · requested {dateShort(order.createdAt)}
            </div>
          </div>
        </div>
        <span
          className={`chip ${awaitingCounter ? 'c-review' : needsPrice ? 'c-quote' : 'c-prog'}`}
        >
          {awaitingCounter
            ? 'Counter pending'
            : needsPrice
              ? 'Needs your price'
              : 'Awaiting customer'}
        </span>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 16,
          marginTop: 16,
          alignItems: 'start',
        }}
      >
        <div>
          <div className="card">
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-clipboard-text" /> What the customer wants
              </span>
            </div>
            <div className="od-line">
              <span className="l">Service</span>
              <span className="v">{order.serviceType ?? '—'}</span>
            </div>
            <div className="od-line">
              <span className="l">Designs</span>
              <span className="v">{designsCountLabel(order)}</span>
            </div>
            <div className="od-line">
              <span className="l">Sizes</span>
              <span className="v">{order.size ?? '—'}</span>
            </div>
            <div className="od-line">
              <span className="l">Notes from customer</span>
              <span className="v" style={{ fontWeight: 400 }}>
                {order.instructions ? `"${order.instructions}"` : '—'}
              </span>
            </div>
          </div>

          <FormPreferencesDisplay preferences={order.preferences} />

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-photo" /> Customer&apos;s artwork
              </span>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {attachments.length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>No artwork uploaded.</span>
              )}
              {attachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="odf"
                  style={{ cursor: 'pointer' }}
                  onClick={() => downloadSignedFile(adminAttachmentUrl(order.id, a.id), a.originalName)}
                >
                  <i className="ti ti-photo" style={{ color: 'var(--navy)' }} /> {a.originalName}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-message" /> Messages on this quote
              </span>
            </div>
            <div className="thread">
              {messages.map((m) => (
                <div key={m.id} className={`tmsg ${m.direction === 'OUTBOUND' ? 'me' : 'them'}`}>
                  {m.body}
                  <div className="tm">
                    {m.direction === 'OUTBOUND' ? 'You' : customerName(order)} · {dateShort(m.createdAt)}
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>No messages yet.</div>
              )}
            </div>
            <div className="thread-in">
              <input
                value={msgDraft}
                placeholder="Reply — ask a question before pricing if you need to…"
                onChange={(e) => setMsgDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && msgDraft.trim()) sendMsg.mutate(msgDraft.trim());
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!msgDraft.trim() || sendMsg.isPending}
                onClick={() => msgDraft.trim() && sendMsg.mutate(msgDraft.trim())}
              >
                <i className="ti ti-send" />
              </button>
            </div>
          </div>
        </div>

        <div>
          {awaitingCounter ? (
            <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-scale" /> Customer counter offer
                </span>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
                  Latest quotation
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
                  {money(latestQuote?.amountCents ?? order.priceCents)}
                </div>
                {latestQuote?.comment && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--muted)',
                      marginBottom: 14,
                      fontStyle: 'italic',
                    }}
                  >
                    &quot;{latestQuote.comment}&quot;
                  </div>
                )}
                <div className="note" style={{ margin: '0 0 14px' }}>
                  <i className="ti ti-info-circle" /> Approve to move the job forward, or reject to
                  send it back.
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
                  disabled={counterApprove.isPending}
                  onClick={() => counterApprove.mutate()}
                >
                  <i className="ti ti-check" />{' '}
                  {counterApprove.isPending ? 'Approving…' : 'Approve counter'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={counterReject.isPending}
                  onClick={() => counterReject.mutate()}
                >
                  <i className="ti ti-x" />{' '}
                  {counterReject.isPending ? 'Rejecting…' : 'Reject counter'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ border: '1.5px solid var(--navy)' }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-currency-dollar" /> Build the quote — price each design
                </span>
              </div>
              <div style={{ padding: '14px 16px' }}>
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
                  Customer&apos;s files — tap one, then attach on a line
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {attachments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`odf${selectedFile === a.originalName ? '' : ''}`}
                      style={{
                        cursor: 'pointer',
                        borderColor: selectedFile === a.originalName ? 'var(--navy)' : undefined,
                      }}
                      onClick={() => setSelectedFile(a.originalName)}
                    >
                      <i className="ti ti-photo" /> {a.originalName}
                    </button>
                  ))}
                </div>

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
                  Quote lines — you decide what the job actually is
                </div>

                {lines.map((line, idx) => (
                  <div key={idx} style={{ marginBottom: 10, borderBottom: '0.5px solid var(--line)', paddingBottom: 10 }}>
                    <input
                      placeholder="Line name"
                      value={line.name}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) => (i === idx ? { ...l, name: e.target.value } : l)),
                        )
                      }
                      style={{
                        width: '100%',
                        border: '0.5px solid var(--line)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        fontSize: 12,
                        marginBottom: 6,
                        fontFamily: 'inherit',
                      }}
                    />
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
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!selectedFile}
                        onClick={() =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, attachedFile: selectedFile } : l,
                            ),
                          )
                        }
                      >
                        Attach
                      </button>
                    </div>
                    {line.attachedFile && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        Attached: {line.attachedFile}
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
                  <i className="ti ti-info-circle" /> Customer can accept or reject each line — they pay only for what
                  they keep.
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={sendQuote.isPending || !lines.some((l) => l.name.trim())}
                  onClick={() => sendQuote.mutate()}
                >
                  <i className="ti ti-send" /> {sendQuote.isPending ? 'Sending…' : 'Send quote — per-design approval'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                  disabled={declineMut.isPending}
                  onClick={() => declineMut.mutate()}
                >
                  <i className="ti ti-x" /> {declineMut.isPending ? 'Declining…' : 'Decline this request'}
                </button>
              </div>
            </div>
          )}

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
              <span className="v">{customer?.accountType?.replace('_', ' ') ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
