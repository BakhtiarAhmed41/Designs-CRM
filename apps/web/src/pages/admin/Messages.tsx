import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateShort, money, statusChipClass, statusLabel } from '@/lib/format';
import { getErrorMessage } from '@/lib/api';
import { getCustomer } from '@/lib/customers';
import { GenerateOrderModal } from '@/components/GenerateOrderModal';
import {
  getAdminConversation,
  listAdminConversations,
  listMessageTemplates,
  sendAdminMessage,
  updateAdminConversation,
  type Conversation,
  type MessageLabel,
} from '@/lib/messaging';
import { listAdminOrders } from '@/lib/orders';
import type { Order, OrderStatus } from '@/lib/types';

type FolderId =
  | 'inbox'
  | 'starred'
  | 'unread'
  | 'sent'
  | 'archived'
  | 'EDIT'
  | 'CUSTOM'
  | 'PAYMENT'
  | 'IMPORTANT';

const LABEL_OPTIONS: Array<{ value: MessageLabel | ''; label: string }> = [
  { value: '', label: 'No label' },
  { value: 'EDIT', label: 'Edit' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'CUSTOM', label: 'Custom' },
  { value: 'IMPORTANT', label: 'Important' },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function relativeTime(iso: string | null | undefined) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return dateShort(iso);
}

function labelClass(label: MessageLabel | null) {
  switch (label) {
    case 'EDIT':
      return 'mlabel lbl-edit';
    case 'PAYMENT':
      return 'mlabel lbl-pay';
    case 'IMPORTANT':
      return 'mlabel lbl-imp';
    case 'CUSTOM':
      return 'mlabel lbl-custom';
    default:
      return '';
  }
}

export function AdminMessages() {
  const [searchParams] = useSearchParams();
  const convoId = searchParams.get('c');

  if (convoId) {
    return <AdminConversationView conversationId={convoId} />;
  }

  return <AdminInboxView />;
}

function AdminInboxView() {
  const navigate = useNavigate();
  const [folder, setFolder] = useState<FolderId>('inbox');

  const inboxQ = useQuery({
    queryKey: ['admin-conversations', 'inbox'],
    queryFn: () => listAdminConversations(),
    refetchInterval: 15_000,
  });

  const archivedQ = useQuery({
    queryKey: ['admin-conversations', 'archived'],
    queryFn: () => listAdminConversations({ archived: true }),
    refetchInterval: 15_000,
    enabled: folder === 'archived',
  });

  const conversations =
    folder === 'archived'
      ? (archivedQ.data?.conversations ?? [])
      : (inboxQ.data?.conversations ?? []);
  const isLoading = folder === 'archived' ? archivedQ.isLoading : inboxQ.isLoading;

  const filtered = useMemo(() => {
    switch (folder) {
      case 'unread':
        return conversations.filter((c) => c.unreadAdmin > 0);
      case 'EDIT':
      case 'CUSTOM':
      case 'PAYMENT':
      case 'IMPORTANT':
        return conversations.filter((c) => c.label === folder);
      case 'starred':
        return conversations.filter((c) => c.label === 'IMPORTANT');
      case 'sent':
        return conversations.filter((c) => c.unreadClient > 0);
      case 'archived':
        return conversations;
      default:
        // inbox: non-archived (already filtered by API)
        return conversations;
    }
  }, [conversations, folder]);

  const inboxConversations = inboxQ.data?.conversations ?? [];
  const unreadCount = inboxConversations.filter((c) => c.unreadAdmin > 0).length;
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of inboxConversations) {
      if (c.label) counts[c.label] = (counts[c.label] ?? 0) + 1;
    }
    return counts;
  }, [inboxConversations]);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Messages</h1>
          <div className="sub">
            All your customer conversations, organized with labels — just like you&apos;re used to, but tied to their orders.
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="inbox">
          <div className="folders">
            <div
              className={`folder${folder === 'inbox' ? ' on' : ''}`}
              onClick={() => setFolder('inbox')}
            >
              <i className="ti ti-inbox" /> Inbox{' '}
              <span className="fc">{inboxConversations.length}</span>
            </div>
            <div
              className={`folder${folder === 'starred' ? ' on' : ''}`}
              onClick={() => setFolder('starred')}
            >
              <i className="ti ti-star" /> Starred{' '}
              <span className="fc">
                {inboxConversations.filter((c) => c.label === 'IMPORTANT').length}
              </span>
            </div>
            <div
              className={`folder${folder === 'unread' ? ' on' : ''}`}
              onClick={() => setFolder('unread')}
            >
              <i className="ti ti-mail-opened" /> Unread <span className="fc">{unreadCount}</span>
            </div>
            <div className={`folder${folder === 'sent' ? ' on' : ''}`} onClick={() => setFolder('sent')}>
              <i className="ti ti-send" /> Sent
            </div>
            <div
              className={`folder${folder === 'archived' ? ' on' : ''}`}
              onClick={() => setFolder('archived')}
            >
              <i className="ti ti-archive" /> Archived
            </div>
            <div className="fg-t">Labels</div>
            <div
              className={`folder${folder === 'CUSTOM' ? ' on' : ''}`}
              onClick={() => setFolder('CUSTOM')}
            >
              <span className="ldot" style={{ background: 'var(--purple)' }} /> Custom requests{' '}
              <span className="fc">{labelCounts.CUSTOM ?? 0}</span>
            </div>
            <div
              className={`folder${folder === 'EDIT' ? ' on' : ''}`}
              onClick={() => setFolder('EDIT')}
            >
              <span className="ldot" style={{ background: 'var(--amber)' }} /> Edits{' '}
              <span className="fc">{labelCounts.EDIT ?? 0}</span>
            </div>
            <div
              className={`folder${folder === 'PAYMENT' ? ' on' : ''}`}
              onClick={() => setFolder('PAYMENT')}
            >
              <span className="ldot" style={{ background: 'var(--green)' }} /> Payment received
            </div>
            <div
              className={`folder${folder === 'IMPORTANT' ? ' on' : ''}`}
              onClick={() => setFolder('IMPORTANT')}
            >
              <span className="ldot" style={{ background: 'var(--maroon)' }} /> Important
            </div>
          </div>

          <div className="inbox-list">
            {isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>}
            {!isLoading && filtered.length === 0 && (
              <div style={{ padding: 16, color: 'var(--muted)' }}>No conversations here.</div>
            )}
            {filtered.map((c) => (
              <InboxRow key={c.id} convo={c} onOpen={() => navigate(`/admin/messages?c=${c.id}`)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InboxRow({ convo, onOpen }: { convo: Conversation; onOpen: () => void }) {
  const name = convo.customerName || convo.subject || 'Conversation';
  return (
    <div className={`mrow${convo.unreadAdmin > 0 ? ' unread' : ''}`} onClick={onOpen}>
      <div className={`mav${convo.unreadAdmin > 0 ? ' m' : ''}`}>{initials(name)}</div>
      <div className="mbody">
        <div className="mtop">
          <span className="mname">{name}</span>
          {convo.label && <span className={labelClass(convo.label)}>{convo.label}</span>}
          {convo.orderRef && (
            <span style={{ fontSize: 10, color: 'var(--faint)' }}>#{convo.orderRef}</span>
          )}
          {convo.unreadAdmin > 0 && <span className="dot-unread" />}
          <span className="mtime">{relativeTime(convo.lastMessageAt)}</span>
        </div>
        <div className="mtext">{convo.lastMessagePreview || 'No messages yet'}</div>
      </div>
    </div>
  );
}

function AdminConversationView({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [privateNotes, setPrivateNotes] = useState('');
  const [genOpen, setGenOpen] = useState(false);

  const threadQuery = useQuery({
    queryKey: ['admin-conversation', conversationId],
    queryFn: () => getAdminConversation(conversationId),
    refetchInterval: 15_000,
  });
  const thread = threadQuery.data?.conversation;

  useEffect(() => {
    setPrivateNotes(thread?.privateNotes ?? '');
  }, [thread?.privateNotes, conversationId]);

  const templatesQuery = useQuery({
    queryKey: ['message-templates'],
    queryFn: listMessageTemplates,
  });

  const ordersQuery = useQuery({
    queryKey: ['admin-orders-msg'],
    queryFn: () => listAdminOrders(),
    enabled: !!thread,
  });

  const customerQuery = useQuery({
    queryKey: ['admin-customer-msg', thread?.customerId],
    queryFn: () => getCustomer(thread!.customerId!),
    enabled: !!thread?.customerId,
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendAdminMessage(conversationId, body),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['admin-conversation', conversationId] });
      qc.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const updateMut = useMutation({
    mutationFn: (data: {
      label?: MessageLabel | null;
      archived?: boolean;
      privateNotes?: string | null;
    }) => updateAdminConversation(conversationId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-conversation', conversationId] });
      qc.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const name = thread?.customerName || thread?.subject || 'Conversation';
  const customer = customerQuery.data?.customer;
  const allOrders = ordersQuery.data?.orders ?? [];
  const orders = thread?.customerId
    ? allOrders.filter((o) => o.customerId === thread.customerId)
    : allOrders;
  const currentOrder = orders.find((o) => o.id === thread?.orderId) ?? orders[0];
  const history = orders.slice(0, 5);

  return (
    <div>
      <div className="ph">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/messages')}>
            <i className="ti ti-arrow-left" /> Inbox
          </button>
          <div>
            <h1 style={{ fontSize: 18 }}>{name}</h1>
            <div className="sub">
              {customer ? `${customer.ordersCount} orders` : 'Customer'} · replied{' '}
              {relativeTime(thread?.lastMessageAt)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={thread?.label ?? ''}
            disabled={updateMut.isPending || !thread}
            onChange={(e) => {
              const v = e.target.value as MessageLabel | '';
              updateMut.mutate({ label: v || null });
            }}
            style={{
              border: '0.5px solid var(--line)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            {LABEL_OPTIONS.map((o) => (
              <option key={o.value || 'none'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={updateMut.isPending || !thread}
            onClick={() => {
              updateMut.mutate(
                { archived: !thread?.archived },
                {
                  onSuccess: () => {
                    if (!thread?.archived) navigate('/admin/messages');
                  },
                },
              );
            }}
          >
            <i className="ti ti-archive" /> {thread?.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => window.open(`/admin/messages?c=${conversationId}`, '_blank')}
          >
            <i className="ti ti-external-link" /> Open in new tab
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setGenOpen(true)}>
            <i className="ti ti-plus" /> Generate order
          </button>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 310px',
          gap: 16,
          marginTop: 16,
          alignItems: 'start',
        }}
      >
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="thread" style={{ maxHeight: 'none', height: 430 }}>
            {threadQuery.isLoading && <div style={{ color: 'var(--muted)' }}>Loading...</div>}
            {thread?.messages.map((m) => (
              <div key={m.id} className={`tmsg ${m.direction === 'OUTBOUND' ? 'me' : 'them'}`}>
                {m.body}
                <div className="tm">
                  {m.direction === 'OUTBOUND' ? 'You' : name} · {relativeTime(m.createdAt)}
                </div>
              </div>
            ))}
            {thread && thread.messages.length === 0 && (
              <div style={{ color: 'var(--muted)' }}>No messages yet.</div>
            )}
          </div>
          <div className="thread-in">
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
                {(templatesQuery.data?.templates ?? []).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setDraft((d) => (d ? `${d}\n${t.body}` : t.body));
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
            <input
              value={draft}
              placeholder="Type your reply…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const body = draft.trim();
                  if (body) sendMutation.mutate(body);
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!draft.trim() || sendMutation.isPending}
              onClick={() => {
                const body = draft.trim();
                if (body) sendMutation.mutate(body);
              }}
            >
              <i className="ti ti-send" />
            </button>
          </div>
        </div>

        <div>
          <div className="card">
            <div style={{ padding: 16, textAlign: 'center', borderBottom: '0.5px solid var(--line)' }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--navy)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 17,
                  margin: '0 auto 8px',
                }}
              >
                {initials(name)}
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {customer?.ordersCount ?? 0} orders · since {dateShort(customer?.sinceDate ?? customer?.createdAt)}
              </div>
            </div>
            <div className="od-line">
              <span className="l">Orders</span>
              <span className="v">{customer?.ordersCount ?? orders.length}</span>
            </div>
            <div className="od-line">
              <span className="l">Lifetime spent</span>
              <span className="v">{money(customer?.ltvCents ?? 0)}</span>
            </div>
            <div className="od-line">
              <span className="l">Store credit</span>
              <span className="v" style={{ color: 'var(--green)' }}>
                {money(customer?.storeCreditCents ?? 0)}
              </span>
            </div>
          </div>

          {currentOrder && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-h">
                <span className="ct">
                  <i className="ti ti-package" /> Current order
                </span>
                <Link
                  to={`/admin/orders/${currentOrder.id}`}
                  style={{ fontSize: 11.5, color: 'var(--navy)', fontWeight: 600 }}
                >
                  Open ↗
                </Link>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  #{currentOrder.humanRef ?? currentOrder.id.slice(0, 6)} · {currentOrder.name ?? 'Order'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 8px' }}>
                  {currentOrder.serviceType ?? 'Service'} · {currentOrder.size ?? '—'} ·{' '}
                  {money(currentOrder.priceCents)}
                </div>
                <span className={statusChipClass(currentOrder.status as OrderStatus)}>
                  {statusLabel(currentOrder.status as OrderStatus)}
                </span>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-history" /> Order history
              </span>
            </div>
            {history.length === 0 && (
              <div style={{ padding: 12, color: 'var(--muted)', fontSize: 12 }}>No orders yet.</div>
            )}
            {history.map((o) => (
              <Link
                key={o.id}
                to={`/admin/orders/${o.id}`}
                className="orow"
                style={{ textDecoration: 'none', color: 'inherit', gridTemplateColumns: '1fr auto auto' }}
              >
                <div className="oinfo">
                  <div className="on" style={{ fontSize: 12.5 }}>
                    #{o.humanRef ?? o.id.slice(0, 6)} · {o.name ?? 'Order'}
                  </div>
                </div>
                <span className={statusChipClass(o.status as OrderStatus)}>
                  {statusLabel(o.status as OrderStatus)}
                </span>
                <div className="oprice">{money(o.priceCents)}</div>
              </Link>
            ))}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-h">
              <span className="ct">
                <i className="ti ti-note" /> Private note
              </span>
            </div>
            <div style={{ padding: '10px 16px 14px' }}>
              <textarea
                placeholder="Only your team sees this…"
                value={privateNotes}
                onChange={(e) => setPrivateNotes(e.target.value)}
                onBlur={() => {
                  const next = privateNotes.trim() || null;
                  const prev = thread?.privateNotes ?? null;
                  if (next === prev) return;
                  updateMut.mutate({ privateNotes: next });
                }}
                style={{
                  width: '100%',
                  border: '0.5px solid var(--line)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  minHeight: 54,
                  outline: 'none',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <GenerateOrderModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        defaultMode="ORDER"
        prefill={{
          customerId: thread?.customerId,
          customerName: customer?.name ?? thread?.customerName,
          email: customer?.email,
          phone: customer?.phone,
        }}
      />
    </div>
  );
}
