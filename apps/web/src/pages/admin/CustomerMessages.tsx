import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/lib/api';
import { whenVisible } from '@/lib/queryRefresh';
import { dateShort, money, statusChipClass, statusLabel } from '@/lib/format';
import {
  chatTypeLabel,
  conversationTitle,
  createAdminConversation,
  deleteAdminConversation,
  getAdminConversation,
  getCustomerMessagingContext,
  listAdminConversations,
  createMessageTemplate,
  deleteMessageTemplate,
  listMessageTemplates,
  sendAdminMessage,
  updateAdminConversation,
  type ChatType,
  type Conversation,
  type ConversationStatus,
} from '@/lib/messaging';
import { useDialog } from '@/components/ui/AppDialog';
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

type FilterKey = 'all' | 'unread' | 'open' | 'closed' | 'GENERAL' | 'ORDER' | 'QUOTE';

/**
 * ChatGPT-style layout:
 * 1) No customer selected → left lists customers
 * 2) Customer selected → left lists THAT customer's chats; right is the thread (+ optional context)
 */
export function AdminCustomerMessages() {
  const { conversationId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const dialog = useDialog();
  const canReply =
    canFeature(user?.permissions, 'messages_customer_reply', user?.role) ||
    canFeature(user?.permissions, 'messages', user?.role);
  const canStart =
    canFeature(user?.permissions, 'messages_customer_start', user?.role) ||
    canFeature(user?.permissions, 'messages', user?.role);
  const hideCustomerDetails = user?.role === 'DESIGNER';

  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [chatSearch, setChatSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    searchParams.get('customer') || null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [topicDraft, setTopicDraft] = useState('');
  const [topicFormOpen, setTopicFormOpen] = useState(false);
  const startMenuRef = useRef<HTMLDivElement>(null);

  const listFilters = useMemo(() => {
    const base: Parameters<typeof listAdminConversations>[0] = { q: q || undefined };
    if (filter === 'unread') base.unread = true;
    if (filter === 'open') base.status = 'OPEN';
    if (filter === 'closed') base.status = 'CLOSED';
    if (filter === 'GENERAL' || filter === 'ORDER' || (filter === 'QUOTE' && !hideCustomerDetails)) {
      base.chatType = filter;
    }
    return base;
  }, [q, filter, hideCustomerDetails]);

  const listQuery = useQuery({
    queryKey: ['admin-conversations', listFilters],
    queryFn: () => listAdminConversations(listFilters),
    refetchInterval: whenVisible(30_000),
  });

  const conversations = listQuery.data?.conversations ?? [];

  const customerGroups = useMemo(() => {
    const visible = hideCustomerDetails
      ? conversations.filter((c) => c.chatType !== 'QUOTE')
      : conversations;
    const map = new Map<
      string,
      { customerId: string; name: string; items: Conversation[]; unread: number; lastAt: string | null }
    >();
    for (const c of visible) {
      const key = c.customerId ?? 'unknown';
      const cur = map.get(key) ?? {
        customerId: key,
        name: hideCustomerDetails
          ? c.orderRef
            ? `Order ${c.orderRef}`
            : conversationTitle(c)
          : c.customerName || 'Unknown customer',
        items: [],
        unread: 0,
        lastAt: null,
      };
      cur.items.push(c);
      cur.unread += Number(c.unreadAdmin || 0);
      if (!cur.lastAt || (c.lastMessageAt && c.lastMessageAt > cur.lastAt)) {
        cur.lastAt = c.lastMessageAt;
        if (hideCustomerDetails) {
          cur.name = c.orderRef ? `Order ${c.orderRef}` : conversationTitle(c);
        }
      }
      if (!hideCustomerDetails && c.customerName) {
        cur.name = c.customerName;
      }
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) =>
      (b.lastAt || '').localeCompare(a.lastAt || ''),
    );
  }, [conversations, hideCustomerDetails]);

  const activeConversationId = conversationId ?? null;

  const threadQuery = useQuery({
    queryKey: ['admin-conversation', activeConversationId],
    queryFn: () => getAdminConversation(activeConversationId as string),
    enabled: !!activeConversationId,
    refetchInterval: whenVisible(20_000),
  });

  const active = threadQuery.data?.conversation;
  const customerId = active?.customerId ?? selectedCustomerId;
  const customerSelected = !!customerId && customerId !== 'unknown';

  useEffect(() => {
    setNotesDraft(active?.privateNotes ?? '');
  }, [active?.id, active?.privateNotes]);

  useEffect(() => {
    if (!startMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!startMenuRef.current?.contains(e.target as Node)) {
        setStartMenuOpen(false);
        setTopicFormOpen(false);
        setTopicDraft('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [startMenuOpen]);

  const contextQuery = useQuery({
    queryKey: ['msg-customer-context', customerId],
    queryFn: () => getCustomerMessagingContext(customerId as string),
    enabled: customerSelected,
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
        p.message?.body ||
          (hideCustomerDetails ? 'Open Messages' : p.conversation?.customerName) ||
          'Open Messages',
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

  const startChat = useMutation({
    mutationFn: (input: {
      chatType: ChatType;
      orderId?: string | null;
      subject?: string;
    }) =>
      createAdminConversation({
        customerId: customerId,
        chatType: input.chatType,
        orderId: input.orderId ?? null,
        subject: input.subject,
      }),
    onSuccess: (res) => {
      setError(null);
      setStartMenuOpen(false);
      setTopicFormOpen(false);
      setTopicDraft('');
      navigate(
        `/admin/messages/customers/${res.conversation.id}?customer=${customerId}`,
      );
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
    setChatSearch('');
    const next = new URLSearchParams(searchParams);
    next.set('customer', id);
    setSearchParams(next, { replace: true });
    const first = conversations
      .filter((c) => c.customerId === id)
      .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))[0];
    if (first) navigate(`/admin/messages/customers/${first.id}?customer=${id}`);
    else navigate(`/admin/messages/customers?customer=${id}`);
  }

  function clearCustomer() {
    setSelectedCustomerId(null);
    setChatSearch('');
    setSearchParams({}, { replace: true });
    navigate('/admin/messages/customers');
  }

  const customerThreads = useMemo(() => {
    const threads = (
      contextQuery.data?.conversations ??
      conversations.filter((c) => c.customerId === customerId)
    ).filter((c) => !hideCustomerDetails || c.chatType !== 'QUOTE');
    const term = chatSearch.trim().toLowerCase();
    const filtered = !term
      ? threads
      : threads.filter((t) => {
          const hay = `${t.subject || ''} ${t.orderRef || ''} ${chatTypeLabel(t.chatType)} ${t.lastMessagePreview || ''}`.toLowerCase();
          return hay.includes(term);
        });
    return [...filtered].sort((a, b) =>
      (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''),
    );
  }, [
    contextQuery.data?.conversations,
    conversations,
    customerId,
    chatSearch,
    hideCustomerDetails,
  ]);

  const deleteChat = useMutation({
    mutationFn: (id: string) => deleteAdminConversation(id),
    onSuccess: (_res, id) => {
      setError(null);
      const remaining = customerThreads.filter((c) => c.id !== id);
      if (id === activeConversationId) {
        if (remaining[0] && customerId) {
          navigate(`/admin/messages/customers/${remaining[0].id}?customer=${customerId}`);
        } else if (customerId) {
          navigate(`/admin/messages/customers?customer=${customerId}`);
        } else {
          navigate('/admin/messages/customers');
        }
      }
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversation', id] });
      void qc.invalidateQueries({ queryKey: ['msg-customer-context', customerId] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  async function confirmDeleteChat(t: Conversation) {
    const ok = await dialog.confirm({
      title: 'Delete this chat?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteChat.mutate(t.id);
  }

  const customerName = hideCustomerDetails
    ? active?.orderRef
      ? `Order ${active.orderRef}`
      : customerGroups.find((g) => g.customerId === customerId)?.name || 'Order chats'
    : contextQuery.data?.customer.name ||
      active?.customerName ||
      customerGroups.find((g) => g.customerId === customerId)?.name ||
      'Customer';

  return (
    <div className={`msg-workspace ${customerSelected ? 'chatgpt' : ''}`}>
      <aside className="msg-left">
        {!customerSelected ? (
          <>
            <div className="msg-left-head">
              <div className="h2" style={{ margin: 0 }}>
                {hideCustomerDetails ? 'Order chats' : 'Customer Messages'}
              </div>
              <input
                className="msg-search"
                placeholder={hideCustomerDetails ? 'Search by order no…' : 'Search customers…'}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => maybeRequestBrowserNotifications()}
              />
              <div className="msg-filters">
                <div className="msg-filters-row cols-4">
                  {(
                    [
                      ['all', 'All'],
                      ['unread', 'Unread'],
                      ['open', 'Open'],
                      ['closed', 'Closed'],
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
                <div className={`msg-filters-row ${hideCustomerDetails ? 'cols-2' : 'cols-3'}`}>
                  {(
                    [
                      ['GENERAL', 'Topics'],
                      ['ORDER', 'Orders'],
                      ...((hideCustomerDetails ? [] : [['QUOTE', 'Quotes']]) as Array<
                        [FilterKey, string]
                      >),
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
            </div>
            <div className="msg-left-list">
              {customerGroups.map((g) => {
                const top = g.items[0];
                return (
                  <button
                    key={g.customerId}
                    type="button"
                    className="msg-cust-card"
                    onClick={() => selectCustomer(g.customerId)}
                  >
                    <div className="av">
                      {hideCustomerDetails ? (
                        <i className="ti ti-package" />
                      ) : (
                        initials(g.name)
                      )}
                    </div>
                    <div className="msg-cust-main">
                      <div className="msg-cust-top">
                        <strong>{g.name}</strong>
                        <span>{relativeTime(g.lastAt)}</span>
                      </div>
                      <div className="msg-cust-preview">
                        {top?.lastMessagePreview || top?.subject || 'No messages'}
                      </div>
                      <div className="msg-cust-meta">
                        <span className="msg-type">{g.items.length} chat{g.items.length === 1 ? '' : 's'}</span>
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
          </>
        ) : (
          <>
            <div className="msg-left-head">
              <button type="button" className="msg-back" onClick={clearCustomer}>
                <i className="ti ti-arrow-left" /> {hideCustomerDetails ? 'All chats' : 'All customers'}
              </button>
              <div className="h2" style={{ margin: '8px 0 0' }}>{customerName}</div>
              <input
                className="msg-search"
                placeholder={hideCustomerDetails ? 'Search by order no…' : 'Search chats…'}
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                onFocus={() => maybeRequestBrowserNotifications()}
              />
              {canStart && (
                <div ref={startMenuRef} style={{ position: 'relative', marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => {
                      setStartMenuOpen((v) => {
                        if (v) {
                          setTopicFormOpen(false);
                          setTopicDraft('');
                        }
                        return !v;
                      });
                    }}
                    disabled={startChat.isPending}
                  >
                    <i className="ti ti-plus" />
                    {startChat.isPending ? 'Starting…' : 'New chat'}
                  </button>
                  {startMenuOpen && (
                    <div className="msg-start-menu">
                      {!topicFormOpen ? (
                        <button
                          type="button"
                          onClick={() => setTopicFormOpen(true)}
                        >
                          <i className="ti ti-message" /> Topic chat…
                        </button>
                      ) : (
                        <form
                          className="msg-topic-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const subject = topicDraft.trim();
                            if (!subject) return;
                            startChat.mutate({
                              chatType: 'GENERAL',
                              subject,
                            });
                          }}
                        >
                          <input
                            className="msg-search"
                            style={{ marginTop: 0 }}
                            autoFocus
                            placeholder="What’s this chat about?"
                            value={topicDraft}
                            onChange={(e) => setTopicDraft(e.target.value)}
                            maxLength={120}
                          />
                          <div className="msg-topic-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setTopicFormOpen(false);
                                setTopicDraft('');
                              }}
                            >
                              Back
                            </button>
                            <button
                              type="submit"
                              className="btn btn-primary btn-sm"
                              disabled={!topicDraft.trim() || startChat.isPending}
                            >
                              {startChat.isPending ? 'Starting…' : 'Start'}
                            </button>
                          </div>
                        </form>
                      )}
                      {(contextQuery.data?.recentOrders ?? []).slice(0, 5).map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() =>
                            startChat.mutate({
                              chatType: 'ORDER',
                              orderId: o.id,
                              subject: o.humanRef
                                ? `Order ${o.humanRef} Chat`
                                : 'Order Chat',
                            })
                          }
                        >
                          <i className="ti ti-package" /> Order {o.humanRef || o.id.slice(0, 6)}
                        </button>
                      ))}
                      {!hideCustomerDetails &&
                        (contextQuery.data?.recentQuotes ?? []).slice(0, 5).map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() =>
                            startChat.mutate({
                              chatType: 'QUOTE',
                              orderId: o.id,
                              subject: o.humanRef
                                ? `Quotation ${o.humanRef} Chat`
                                : 'Quotation Chat',
                            })
                          }
                        >
                          <i className="ti ti-file-invoice" /> Quote {o.humanRef || o.id.slice(0, 6)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="msg-left-list">
              {customerThreads.map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  className={`msg-cust-card ${t.id === activeConversationId ? 'on' : ''}`}
                  onClick={() =>
                    navigate(`/admin/messages/customers/${t.id}?customer=${customerId}`)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/admin/messages/customers/${t.id}?customer=${customerId}`);
                    }
                  }}
                >
                  <div className="msg-cust-main" style={{ width: '100%' }}>
                    <div className="msg-cust-top">
                      <strong>{conversationTitle(t)}</strong>
                      <span>{relativeTime(t.lastMessageAt)}</span>
                    </div>
                    <div className="msg-cust-preview">
                      {t.lastMessagePreview || 'No messages yet'}
                    </div>
                    <div className="msg-cust-meta">
                      {t.chatType === 'GENERAL' && (
                        <span className="msg-type">{chatTypeLabel(t.chatType)}</span>
                      )}
                      {t.unreadAdmin > 0 && <span className="msg-badge">{t.unreadAdmin}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn danger msg-thread-delete"
                    aria-label="Delete chat"
                    title="Delete chat"
                    disabled={deleteChat.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDeleteChat(t);
                    }}
                  >
                    <i className="ti ti-trash" />
                  </button>
                </div>
              ))}
              {customerThreads.length === 0 && (
                <div className="msg-empty">No chats yet. Start a new conversation.</div>
              )}
            </div>
          </>
        )}
      </aside>

      <section className="msg-center">
        {!customerSelected ? (
          <div className="msg-empty-state">
            {hideCustomerDetails
              ? 'Select an order chat to open it.'
              : 'Select a customer to open their chats.'}
          </div>
        ) : activeConversationId && active ? (
          <>
            <div className="msg-center-head">
              <div>
                <div className="h2" style={{ margin: 0 }}>
                  {conversationTitle(active)}
                </div>
                <div
                  className="muted"
                  style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}
                >
                  <span className={`chip ${active.status === 'OPEN' ? 'c-done' : 'c-wait'}`}>
                    {active.status === 'OPEN' ? 'Open' : 'Closed'}
                  </span>
                </div>
              </div>
              <div className="msg-center-actions">
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
              </div>
            </div>
            <ConversationThread
              messages={active.messages ?? []}
              mineDirection="OUTBOUND"
            />
            {error && <div className="err" style={{ margin: '0 12px' }}>{error}</div>}
            {!canReply && active.status === 'OPEN' && (
              <div className="muted" style={{ margin: '0 12px 8px', fontSize: 12.5 }}>
                You don’t have permission to reply in customer chats.
              </div>
            )}
            <MessageComposer
              disabled={!canReply || active.status === 'CLOSED'}
              placeholder={
                !canReply
                  ? 'No reply permission'
                  : active.status === 'CLOSED'
                    ? 'Conversation is closed'
                    : 'Type a message…'
              }
              templates={templatesQuery.data?.templates}
              onCreateTemplate={async (title, body) => {
                await createMessageTemplate({ title, body });
                void qc.invalidateQueries({ queryKey: ['message-templates'] });
              }}
              onDeleteTemplate={async (templateId) => {
                await deleteMessageTemplate(templateId);
                void qc.invalidateQueries({ queryKey: ['message-templates'] });
              }}
              onSend={async (body, files) => {
                await sendMutation.mutateAsync({ body, files });
              }}
            />
          </>
        ) : (
          <div className="msg-empty-state">Select a chat on the left, or start a new one.</div>
        )}
      </section>

      {customerSelected && (
        <aside className="msg-right">
          {!contextQuery.data ? (
            <div className="msg-empty">
              {hideCustomerDetails ? 'Order details appear here.' : 'Customer context appears here.'}
            </div>
          ) : (
            <>
              {!hideCustomerDetails && (
              <div className="msg-right-section">
                <div className="msg-right-title">Customer Information</div>
                <div className="msg-kv"><span>Name</span><b>{contextQuery.data.customer.name}</b></div>
                <div className="msg-kv"><span>Phone</span><b>{contextQuery.data.customer.phone || 'None'}</b></div>
                <div className="msg-kv"><span>Email</span><b>{contextQuery.data.customer.email || 'None'}</b></div>
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
              </div>
              )}

              <div className="msg-right-section">
                <div className="msg-right-title">Recent Orders</div>
                {contextQuery.data.recentOrders.map((o) => (
                  <div key={o.id} className="msg-side-row" style={{ gap: 8 }}>
                    <Link to={`/admin/orders/${o.id}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
                      <b>{o.humanRef || o.id.slice(0, 8)}</b>
                      <div className="muted">{dateShort(o.createdAt)}</div>
                    </Link>
                    {canStart && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Start order chat"
                        onClick={() =>
                          startChat.mutate({
                            chatType: 'ORDER',
                            orderId: o.id,
                            subject: o.humanRef ? `Order ${o.humanRef} Chat` : 'Order Chat',
                          })
                        }
                      >
                        <i className="ti ti-message" />
                      </button>
                    )}
                    <span className={`chip ${statusChipClass(o.status as OrderStatus)}`}>
                      {statusLabel(o.status as OrderStatus)}
                    </span>
                  </div>
                ))}
                {contextQuery.data.recentOrders.length === 0 && (
                  <div className="muted">No orders</div>
                )}
              </div>

              {!hideCustomerDetails && (
              <div className="msg-right-section">
                <div className="msg-right-title">Recent Quotations</div>
                {contextQuery.data.recentQuotes.map((o) => (
                  <div key={o.id} className="msg-side-row" style={{ gap: 8 }}>
                    <Link to={`/admin/quotes/${o.id}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
                      <b>{o.humanRef || o.id.slice(0, 8)}</b>
                      <div className="muted">{dateShort(o.createdAt)}</div>
                    </Link>
                    {canStart && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Start quote chat"
                        onClick={() =>
                          startChat.mutate({
                            chatType: 'QUOTE',
                            orderId: o.id,
                            subject: o.humanRef
                              ? `Quotation ${o.humanRef} Chat`
                              : 'Quotation Chat',
                          })
                        }
                      >
                        <i className="ti ti-message" />
                      </button>
                    )}
                    <span className={`chip ${statusChipClass(o.status as OrderStatus)}`}>
                      {statusLabel(o.status as OrderStatus)}
                    </span>
                  </div>
                ))}
                {contextQuery.data.recentQuotes.length === 0 && (
                  <div className="muted">No quotes</div>
                )}
              </div>
              )}

              {active && (
                <div className="msg-right-section">
                  <div className="msg-right-title">Private notes</div>
                  <textarea
                    rows={4}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    onBlur={() => {
                      if (notesDraft !== (active.privateNotes || '')) {
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
      )}
    </div>
  );
}
