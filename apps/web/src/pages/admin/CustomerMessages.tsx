import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/lib/api';
import { dateShort, money, statusChipClass, statusLabel } from '@/lib/format';
import {
  chatTypeLabel,
  createAdminConversation,
  getAdminConversation,
  getCustomerMessagingContext,
  listAdminConversations,
  listMessageTemplates,
  sendAdminMessage,
  updateAdminConversation,
  type ChatType,
  type Conversation,
  type ConversationStatus,
} from '@/lib/messaging';
import { canFeature } from '@/lib/permissions';
import type { OrderStatus } from '@/lib/types';
import {
  maybeRequestBrowserNotifications,
  showBrowserNotification,
  useMessagingSocket,
} from '@/hooks/useMessagingSocket';

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
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return dateShort(iso);
}

type FilterKey =
  | 'all'
  | 'unread'
  | 'read'
  | 'open'
  | 'closed'
  | 'GENERAL'
  | 'ORDER'
  | 'QUOTE';

export function AdminCustomerMessages() {
  const { conversationId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canReply = canFeature(user?.permissions, 'messages_customer_reply') ||
    canFeature(user?.permissions, 'messages');
  const canStart = canFeature(user?.permissions, 'messages_customer_start') ||
    canFeature(user?.permissions, 'messages');

  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    searchParams.get('customer') || null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const listFilters = useMemo(() => {
    const base: Parameters<typeof listAdminConversations>[0] = { q: q || undefined };
    if (filter === 'unread') base.unread = true;
    if (filter === 'read') base.read = true;
    if (filter === 'open') base.status = 'OPEN';
    if (filter === 'closed') base.status = 'CLOSED';
    if (filter === 'GENERAL' || filter === 'ORDER' || filter === 'QUOTE') {
      base.chatType = filter;
    }
    return base;
  }, [q, filter]);

  const listQuery = useQuery({
    queryKey: ['admin-conversations', listFilters],
    queryFn: () => listAdminConversations(listFilters),
    refetchInterval: 30_000,
  });

  const conversations = listQuery.data?.conversations ?? [];

  const customerGroups = useMemo(() => {
    const map = new Map<
      string,
      { customerId: string; name: string; items: Conversation[]; unread: number; lastAt: string | null }
    >();
    for (const c of conversations) {
      const key = c.customerId ?? 'unknown';
      const cur = map.get(key) ?? {
        customerId: key,
        name: c.customerName || 'Unknown customer',
        items: [],
        unread: 0,
        lastAt: null,
      };
      cur.items.push(c);
      cur.unread += Number(c.unreadAdmin || 0);
      if (!cur.lastAt || (c.lastMessageAt && c.lastMessageAt > cur.lastAt)) {
        cur.lastAt = c.lastMessageAt;
      }
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) =>
      (b.lastAt || '').localeCompare(a.lastAt || ''),
    );
  }, [conversations]);

  const activeConversationId = conversationId ?? null;

  const threadQuery = useQuery({
    queryKey: ['admin-conversation', activeConversationId],
    queryFn: () => getAdminConversation(activeConversationId as string),
    enabled: !!activeConversationId,
    refetchInterval: 20_000,
  });

  const active = threadQuery.data?.conversation;
  const customerId = active?.customerId ?? selectedCustomerId;

  const contextQuery = useQuery({
    queryKey: ['msg-customer-context', customerId],
    queryFn: () => getCustomerMessagingContext(customerId as string),
    enabled: !!customerId && customerId !== 'unknown',
  });

  const templatesQuery = useQuery({
    queryKey: ['message-templates'],
    queryFn: listMessageTemplates,
  });

  useMessagingSocket({
    conversationId: activeConversationId,
    onMessageNew: (payload) => {
      const p = payload as { conversation?: { customerName?: string }; message?: { body?: string } };
      showBrowserNotification(
        'New customer message',
        p.message?.body || p.conversation?.customerName || 'Open Messages',
      );
      if (activeConversationId) {
        void qc.invalidateQueries({ queryKey: ['admin-conversation', activeConversationId] });
      }
    },
  });

  const sendMutation = useMutation({
    mutationFn: ({ body, files }: { body: string; files: File[] }) =>
      sendAdminMessage(activeConversationId as string, body, files),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin-conversation', activeConversationId] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const startGeneral = useMutation({
    mutationFn: () =>
      createAdminConversation({
        customerId: customerId,
        chatType: 'GENERAL',
        subject: 'General Inquiry',
      }),
    onSuccess: (res) => {
      navigate(`/admin/messages/customers/${res.conversation.id}`);
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      void qc.invalidateQueries({ queryKey: ['msg-customer-context', customerId] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { status?: ConversationStatus; privateNotes?: string | null }) =>
      updateAdminConversation(activeConversationId as string, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-conversation', activeConversationId] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
  });

  function selectCustomer(id: string) {
    setSelectedCustomerId(id);
    const next = new URLSearchParams(searchParams);
    next.set('customer', id);
    setSearchParams(next, { replace: true });
    const first = conversations.find((c) => c.customerId === id);
    if (first) navigate(`/admin/messages/customers/${first.id}?customer=${id}`);
    else navigate(`/admin/messages/customers?customer=${id}`);
  }

  const customerThreads =
    contextQuery.data?.conversations ??
    conversations.filter((c) => c.customerId === customerId);

  return (
    <div className="msg-workspace">
      <aside className="msg-left">
        <div className="msg-left-head">
          <div className="h2" style={{ margin: 0 }}>Customer Messages</div>
          <input
            className="msg-search"
            placeholder="Search name, phone, email, order…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => maybeRequestBrowserNotifications()}
          />
          <div className="filters" style={{ marginTop: 8 }}>
            {(
              [
                ['all', 'All'],
                ['unread', 'Unread'],
                ['open', 'Open'],
                ['closed', 'Closed'],
                ['GENERAL', 'General'],
                ['ORDER', 'Orders'],
                ['QUOTE', 'Quotes'],
              ] as Array<[FilterKey, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'on' : ''}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="msg-left-list">
          {customerGroups.map((g) => {
            const top = g.items[0];
            const on = g.customerId === customerId;
            return (
              <button
                key={g.customerId}
                type="button"
                className={`msg-cust-card ${on ? 'on' : ''}`}
                onClick={() => selectCustomer(g.customerId)}
              >
                <div className="av">{initials(g.name)}</div>
                <div className="msg-cust-main">
                  <div className="msg-cust-top">
                    <strong>{g.name}</strong>
                    <span>{relativeTime(g.lastAt)}</span>
                  </div>
                  <div className="msg-cust-preview">
                    {top?.lastMessagePreview || top?.subject || 'No messages'}
                  </div>
                  <div className="msg-cust-meta">
                    <span className="msg-type">{chatTypeLabel(top?.chatType as ChatType)}</span>
                    {g.unread > 0 && <span className="msg-badge">{g.unread}</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {!listQuery.isLoading && customerGroups.length === 0 && (
            <div className="msg-empty">No conversations match.</div>
          )}
        </div>
      </aside>

      <section className="msg-center">
        {!customerId ? (
          <div className="msg-empty-state">Select a customer to open conversations.</div>
        ) : (
          <>
            <div className="msg-center-head">
              <div>
                <div className="h2" style={{ margin: 0 }}>
                  {contextQuery.data?.customer.name || active?.customerName || 'Customer'}
                </div>
                <div className="muted" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                  {active ? (
                    <>
                      <span>
                        {chatTypeLabel(active.chatType)}
                        {active.orderRef ? ` · ${active.orderRef}` : ''}
                      </span>
                      <span className={`chip ${active.status === 'OPEN' ? 'c-done' : 'c-wait'}`}>
                        {active.status === 'OPEN' ? 'Open' : 'Closed'}
                      </span>
                    </>
                  ) : (
                    'Choose a conversation'
                  )}
                </div>
              </div>
              <div className="msg-center-actions">
                {canStart && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => startGeneral.mutate()}
                    disabled={startGeneral.isPending}
                  >
                    <i className="ti ti-message" />
                    {startGeneral.isPending ? 'Starting…' : 'Start New Chat'}
                  </button>
                )}
                {active && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      updateMutation.mutate({
                        status: active.status === 'OPEN' ? 'CLOSED' : 'OPEN',
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    <i className={`ti ${active.status === 'OPEN' ? 'ti-x' : 'ti-refresh'}`} />
                    {active.status === 'OPEN' ? 'Close' : 'Reopen'}
                  </button>
                )}
              </div>
            </div>

            <div className="msg-thread-tabs">
              {customerThreads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={t.id === activeConversationId ? 'on' : ''}
                  onClick={() =>
                    navigate(`/admin/messages/customers/${t.id}?customer=${customerId}`)
                  }
                >
                  {chatTypeLabel(t.chatType)}
                  {t.orderRef ? ` ${t.orderRef}` : ''}
                  {t.unreadAdmin > 0 && <span className="msg-badge">{t.unreadAdmin}</span>}
                </button>
              ))}
            </div>

            {activeConversationId && active ? (
              <>
                <ConversationThread messages={active.messages} mineDirection="OUTBOUND" />
                {error && <div className="err" style={{ margin: '0 12px' }}>{error}</div>}
                <MessageComposer
                  disabled={!canReply || active.status === 'CLOSED'}
                  templates={templatesQuery.data?.templates}
                  onSend={async (body, files) => {
                    await sendMutation.mutateAsync({ body, files });
                  }}
                />
              </>
            ) : (
              <div className="msg-empty-state">Select or start a conversation.</div>
            )}
          </>
        )}
      </section>

      <aside className="msg-right">
        {!contextQuery.data ? (
          <div className="msg-empty">Customer context appears here.</div>
        ) : (
          <>
            <div className="msg-right-section">
              <div className="msg-right-title">Customer Information</div>
              <div className="msg-kv"><span>Name</span><b>{contextQuery.data.customer.name}</b></div>
              <div className="msg-kv"><span>Phone</span><b>{contextQuery.data.customer.phone || '—'}</b></div>
              <div className="msg-kv"><span>Email</span><b>{contextQuery.data.customer.email || '—'}</b></div>
              <div className="msg-kv">
                <span>Customer since</span>
                <b>{dateShort(contextQuery.data.customer.customerSince)}</b>
              </div>
              <div className="msg-kv">
                <span>Total orders</span>
                <b>{contextQuery.data.customer.totalOrders}</b>
              </div>
              <div className="msg-kv">
                <span>Total spending</span>
                <b>{money(contextQuery.data.customer.totalSpentCents)}</b>
              </div>
              <div className="msg-kv">
                <span>Last contact</span>
                <b>{dateShort(contextQuery.data.customer.lastContactAt)}</b>
              </div>
            </div>

            <div className="msg-right-section">
              <div className="msg-right-title">Recent Orders</div>
              {contextQuery.data.recentOrders.map((o) => (
                <Link key={o.id} to={`/admin/orders/${o.id}`} className="msg-side-row">
                  <div>
                    <b>{o.humanRef || o.id.slice(0, 8)}</b>
                    <div className="muted">{dateShort(o.createdAt)}</div>
                  </div>
                  <div>
                    <span className={`chip ${statusChipClass(o.status as OrderStatus)}`}>
                      {statusLabel(o.status as OrderStatus)}
                    </span>
                    <div className="muted" style={{ textAlign: 'right' }}>
                      {money(o.totalCents)}
                    </div>
                  </div>
                </Link>
              ))}
              {contextQuery.data.recentOrders.length === 0 && (
                <div className="muted">No orders</div>
              )}
            </div>

            <div className="msg-right-section">
              <div className="msg-right-title">Recent Quotations</div>
              {contextQuery.data.recentQuotes.map((o) => (
                <Link key={o.id} to={`/admin/quotes/${o.id}`} className="msg-side-row">
                  <div>
                    <b>{o.humanRef || o.id.slice(0, 8)}</b>
                    <div className="muted">{dateShort(o.createdAt)}</div>
                  </div>
                  <span className={`chip ${statusChipClass(o.status as OrderStatus)}`}>
                    {statusLabel(o.status as OrderStatus)}
                  </span>
                </Link>
              ))}
              {contextQuery.data.recentQuotes.length === 0 && (
                <div className="muted">No quotes</div>
              )}
            </div>

            {active && (
              <div className="msg-right-section">
                <div className="msg-right-title">Private notes</div>
                <textarea
                  rows={4}
                  value={notesDraft || active.privateNotes || ''}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => {
                    if ((notesDraft || '') !== (active.privateNotes || '')) {
                      updateMutation.mutate({ privateNotes: notesDraft });
                    }
                  }}
                  placeholder="Visible to staff only"
                />
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
