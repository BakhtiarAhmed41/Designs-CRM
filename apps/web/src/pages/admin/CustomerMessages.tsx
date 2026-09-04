import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/lib/api';
import { whenVisible } from '@/lib/queryRefresh';
import {
  conversationTitle,
  conversationWorkLine,
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
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
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
    .toUpperCase() || 'C';
}

function inboxTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function inboxTitle(c: Conversation, hideCustomerDetails: boolean) {
  if (hideCustomerDetails) {
    return c.orderRef ? `Order ${c.orderRef}` : conversationTitle(c);
  }
  return c.customerName?.trim() || 'Customer';
}

type FilterKey = 'all' | 'unread' | 'open' | 'closed' | 'GENERAL' | 'ORDER' | 'QUOTE';

const FILTERS: Array<{ key: FilterKey; label: string; icon: string }> = [
  { key: 'all', label: 'Inbox', icon: 'ti-inbox' },
  { key: 'unread', label: 'Unread', icon: 'ti-messages' },
  { key: 'open', label: 'Open', icon: 'ti-point' },
  { key: 'closed', label: 'Closed', icon: 'ti-circle-check' },
  { key: 'GENERAL', label: 'Topics', icon: 'ti-message' },
  { key: 'ORDER', label: 'Orders', icon: 'ti-package' },
  { key: 'QUOTE', label: 'Quotes', icon: 'ti-file-invoice' },
];

export function AdminCustomerMessages() {
  const { conversationId } = useParams();
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

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [startMenuOpen, setStartMenuOpen] = useState(false);
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

  const conversations = useMemo(() => {
    const all = listQuery.data?.conversations ?? [];
    return hideCustomerDetails ? all.filter((c) => c.chatType !== 'QUOTE') : all;
  }, [listQuery.data?.conversations, hideCustomerDetails]);

  const activeConversationId = conversationId ?? null;

  const threadQuery = useQuery({
    queryKey: ['admin-conversation', activeConversationId],
    queryFn: () => getAdminConversation(activeConversationId as string),
    enabled: !!activeConversationId,
    refetchInterval: whenVisible(20_000),
  });

  const active = threadQuery.data?.conversation;
  const customerId = active?.customerId ?? null;

  useEffect(() => {
    setNotesDraft(active?.privateNotes ?? '');
  }, [active?.id, active?.privateNotes]);

  useEffect(() => {
    if (!startMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!startMenuRef.current?.contains(e.target as Node)) {
        setStartMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [startMenuOpen]);

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
        p.message?.body ||
          (hideCustomerDetails ? 'Open Messages' : p.conversation?.customerName) ||
          'Open Messages',
      );
      if (activeConversationId) {
        void qc.invalidateQueries({ queryKey: ['admin-conversation', activeConversationId] });
      }
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
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
        customerId,
        chatType: input.chatType,
        orderId: input.orderId ?? null,
        subject: input.subject,
      }),
    onSuccess: (res) => {
      setError(null);
      setStartMenuOpen(false);
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

  const deleteChat = useMutation({
    mutationFn: (id: string) => deleteAdminConversation(id),
    onSuccess: () => {
      setError(null);
      navigate('/admin/messages/customers');
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversation'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  async function confirmDeleteChat(id: string) {
    const ok = await dialog.confirm({
      title: 'Delete this chat?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteChat.mutate(id);
  }

  function openConvo(c: Conversation) {
    navigate(`/admin/messages/customers/${c.id}`);
    maybeRequestBrowserNotifications();
  }

  function backToInbox() {
    setError(null);
    navigate('/admin/messages/customers');
  }

  const displayName = hideCustomerDetails
    ? active
      ? inboxTitle(active, true)
      : 'Conversation'
    : active?.customerName?.trim() ||
      contextQuery.data?.customer.name ||
      'Customer';

  const workLine = active ? conversationWorkLine(active) : null;
  const visibleFilters = hideCustomerDetails
    ? FILTERS.filter((f) => f.key !== 'QUOTE')
    : FILTERS;

  function filterNav() {
    return (
      <aside className="admin-inbox-nav" aria-label="Message folders">
        <div className="admin-inbox-nav-title">
          {hideCustomerDetails ? 'Order chats' : 'Customer messages'}
        </div>
        {visibleFilters.map((item) => (
          <button
            key={item.key}
            type="button"
            className={filter === item.key ? 'on' : undefined}
            onClick={() => {
              setFilter(item.key);
              if (activeConversationId) backToInbox();
            }}
          >
            <i className={`ti ${item.icon}`} aria-hidden />
            {item.label}
          </button>
        ))}
      </aside>
    );
  }

  if (activeConversationId) {
    return (
      <div className="msg-workspace portal portal-thread">
        <section className="msg-center">
          <div className="msg-center-head portal-thread-head">
            <button
              type="button"
              className="icon-btn"
              aria-label="Back to inbox"
              onClick={backToInbox}
            >
              <i className="ti ti-arrow-left" />
            </button>
            <div className="thumb" aria-hidden>
              {hideCustomerDetails ? (
                <i className="ti ti-package" />
              ) : (
                initials(displayName)
              )}
            </div>
            <div className="portal-thread-title">
              <div className="on">{displayName}</div>
              {workLine && <div className="om">{workLine}</div>}
            </div>
            {active && (
              <div className="msg-center-actions">
                {canStart && customerId && (
                  <div ref={startMenuRef} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setStartMenuOpen((v) => !v)}
                      disabled={startChat.isPending}
                    >
                      <i className="ti ti-plus" /> New chat
                    </button>
                    {startMenuOpen && (
                      <div className="msg-start-menu" style={{ left: 'auto', right: 0, minWidth: 220 }}>
                        <button
                          type="button"
                          onClick={() => startChat.mutate({ chatType: 'GENERAL' })}
                        >
                          <i className="ti ti-message" /> Topic chat
                        </button>
                        {(contextQuery.data?.recentOrders ?? []).slice(0, 5).map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() =>
                              startChat.mutate({
                                chatType: 'ORDER',
                                orderId: o.id,
                                subject: o.humanRef ? `Order ${o.humanRef} Chat` : 'Order Chat',
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
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label="Delete chat"
                  disabled={deleteChat.isPending}
                  onClick={() => confirmDeleteChat(active.id)}
                >
                  <i className="ti ti-trash" />
                </button>
              </div>
            )}
          </div>
          {error && <div className="err" style={{ margin: '0 12px' }}>{error}</div>}
          {threadQuery.isLoading && (
            <EmptyState icon="ti-loader" title="Loading conversation…" />
          )}
          {threadQuery.isError && (
            <EmptyState
              icon="ti-alert-circle"
              title="Could not open this chat"
              action={
                <button type="button" className="btn btn-ghost btn-sm" onClick={backToInbox}>
                  Back to inbox
                </button>
              }
            />
          )}
          {active && (
            <>
              <ConversationThread
                messages={active.messages ?? []}
                mineDirection="OUTBOUND"
              />
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
                      : 'Write a reply…'
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
              <div className="admin-thread-notes">
                <label htmlFor="admin-private-notes">Private notes</label>
                <textarea
                  id="admin-thread-notes"
                  rows={2}
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
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="admin-inbox-page">
      {filterNav()}
      <div className="admin-inbox-main">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="searchbar inbox-search">
        <i className="ti ti-search si" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => maybeRequestBrowserNotifications()}
          placeholder={hideCustomerDetails ? 'Search by order no…' : 'Search messages…'}
          aria-label="Search messages"
        />
      </div>

      <div className="card">
        {listQuery.isLoading && <SkeletonRows rows={6} />}
        {!listQuery.isLoading && conversations.length === 0 && (
          <EmptyState
            icon="ti-inbox"
            title={q.trim() || filter !== 'all' ? 'No matching conversations' : 'No conversations yet'}
            description="Chats show up here when a customer messages you from a quote, order, or the inbox."
          />
        )}
        {conversations.map((c) => {
          const work = conversationWorkLine(c);
          const name = inboxTitle(c, hideCustomerDetails);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className="orow inbox-row"
              onClick={() => openConvo(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openConvo(c);
                }
              }}
            >
              <div className="thumb">
                {hideCustomerDetails ? (
                  <i className="ti ti-package" />
                ) : (
                  initials(name)
                )}
              </div>
              <div className="oinfo">
                <div className="on">{name}</div>
                <div className="om inbox-snippet">
                  {c.lastMessagePreview || 'No messages yet'}
                </div>
                {work && <div className="om inbox-work">{work}</div>}
              </div>
              <div className="inbox-meta">
                <span>{inboxTime(c.lastMessageAt)}</span>
                {c.unreadAdmin > 0 && <span className="msg-badge">{c.unreadAdmin}</span>}
              </div>
              <i className="ti ti-chevron-right inbox-chevron" aria-hidden />
            </div>
          );
        })}
        {!listQuery.isLoading && conversations.length > 0 && (
          <div className="inbox-hint">Select a conversation to view messages.</div>
        )}
      </div>
      </div>
    </div>
  );
}
