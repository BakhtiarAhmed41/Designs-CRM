import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/lib/api';
import { whenVisible } from '@/lib/queryRefresh';
import {
  bulkAdminConversations,
  conversationTitle,
  conversationRefLabel,
  conversationWorkLine,
  helpRequestTitle,
  isHelpRequest,
  createAdminConversation,
  deleteAdminConversation,
  getAdminConversation,
  getCustomerMessagingContext,
  isStarred,
  listAdminConversations,
  markConversationSeenInCache,
  createMessageTemplate,
  deleteMessageTemplate,
  listMessageTemplates,
  sendAdminMessage,
  updateAdminConversation,
  type ChatType,
  type Conversation,
  type ConversationStatus,
  type Message,
} from '@/lib/messaging';
import { HelpRequestBadge, InboxBulkBar, InboxStarButton } from '@/components/messaging/InboxTools';
import { PaginationBar } from '@/components/lists/ListToolbar';
import { dateShort, money, statusChipClass, statusLabel, orderNumber, orderSlug } from '@/lib/format';
import { useDialog } from '@/components/ui/AppDialog';
import { canFeature } from '@/lib/permissions';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { CreateInvoiceModal } from '@/components/CreateInvoiceModal';
import { RevisionModal } from '@/components/RevisionModal';
import { createAdminEdit } from '@/lib/edits';
import { getAdminOrder } from '@/lib/orders';
import { listTeam } from '@/lib/team';
import type { Design } from '@/lib/designs';
import type { Order } from '@/lib/types';
import { SkeletonRows } from '@/components/ui/Skeleton';
import {
  emitConversationTyping,
  maybeRequestBrowserNotifications,
  showBrowserNotification,
  useMessagingSocket,
} from '@/hooks/useMessagingSocket';

function latestCustomerAsk(messages: Message[] | undefined) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i -= 1) {
    const message = messages?.[i];
    if (!message || message.deletedAt || message.direction !== 'INBOUND') continue;
    const body = message.body.trim();
    if (body) return body;
  }
  return '';
}

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

function accountTypeLabel(type: string | null | undefined) {
  if (type === 'NET_MONTHLY') return 'Net monthly';
  if (type === 'PAY_PER_ORDER') return 'Pay per order';
  if (!type?.trim()) return '—';
  return type.replace(/_/g, ' ');
}

function sinceLabel(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function inboxTitle(c: Conversation, hideCustomerDetails: boolean) {
  if (hideCustomerDetails) {
    return c.orderRef ? `Order ${c.orderRef}` : conversationTitle(c);
  }
  return c.customerName?.trim() || 'Customer';
}

type FilterKey = 'all' | 'starred' | 'unread' | 'open' | 'closed' | 'GENERAL' | 'ORDER' | 'QUOTE';

const INBOX_PAGE_SIZE = 10;

const FILTERS: Array<{ key: FilterKey; label: string; icon: string }> = [
  { key: 'all', label: 'Inbox', icon: 'ti-inbox' },
  { key: 'starred', label: 'Starred', icon: 'ti-user-star' },
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
  const canBill = canFeature(user?.permissions, 'billing', user?.role);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionToast, setRevisionToast] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const startMenuRef = useRef<HTMLDivElement>(null);

  const listFilters = useMemo(() => {
    const base: Parameters<typeof listAdminConversations>[0] = { q: q || undefined };
    if (filter === 'starred') base.starred = true;
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
    const visible = hideCustomerDetails ? all.filter((c) => c.chatType !== 'QUOTE') : all;
    if (filter === 'starred') return visible.filter((c) => isStarred(c, 'admin'));
    return visible;
  }, [listQuery.data?.conversations, hideCustomerDetails, filter]);

  const totalPages = Math.max(1, Math.ceil(conversations.length / INBOX_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedConversations = conversations.slice(
    (currentPage - 1) * INBOX_PAGE_SIZE,
    currentPage * INBOX_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [q, filter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setSelected((ids) => ids.filter((id) => conversations.some((c) => c.id === id)));
  }, [conversations]);

  const activeConversationId = conversationId ?? null;

  const threadQuery = useQuery({
    queryKey: ['admin-conversation', activeConversationId],
    queryFn: () => getAdminConversation(activeConversationId as string),
    enabled: !!activeConversationId,
    refetchInterval: whenVisible(20_000),
  });

  useEffect(() => {
    if (!activeConversationId) return;
    markConversationSeenInCache(qc, activeConversationId, 'admin');
  }, [activeConversationId, qc]);

  useEffect(() => {
    if (!activeConversationId || !threadQuery.isSuccess) return;
    markConversationSeenInCache(qc, activeConversationId, 'admin');
    void qc.invalidateQueries({ queryKey: ['admin-unread-messages'] });
  }, [activeConversationId, threadQuery.isSuccess, qc]);

  const active = threadQuery.data?.conversation;
  const listedActive = conversations.find((c) => c.id === activeConversationId);
  const customerId = active?.customerId ?? listedActive?.customerId ?? null;

  const orderChatId =
    active?.chatType === 'ORDER' && active.orderId && active.orderType !== 'QUOTE_REQUEST'
      ? active.orderId
      : null;

  useEffect(() => {
    setNotesDraft(active?.privateNotes ?? '');
    setRevisionOpen(false);
    setInvoiceOpen(false);
  }, [active?.id, active?.privateNotes]);

  useEffect(() => {
    if (!revisionToast) return;
    const timer = window.setTimeout(() => setRevisionToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [revisionToast]);

  const revisionOrderQ = useQuery({
    queryKey: ['admin-order', orderChatId],
    queryFn: () => getAdminOrder(orderChatId as string),
    enabled: revisionOpen && Boolean(orderChatId),
  });
  const revisionTeamQ = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
    enabled: revisionOpen && Boolean(orderChatId),
  });

  useEffect(() => {
    if (!revisionOpen) return;
    const failed = revisionOrderQ.error ?? revisionTeamQ.error;
    if (!failed) return;
    setError(getErrorMessage(failed));
    setRevisionOpen(false);
  }, [revisionOpen, revisionOrderQ.error, revisionTeamQ.error]);

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
      setPeerTyping(false);
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
    onTyping: (payload) => {
      const p = payload as { conversationId?: string; typing?: boolean };
      if (p.conversationId && p.conversationId === activeConversationId) {
        setPeerTyping(Boolean(p.typing));
      }
    },
  });

  useEffect(() => {
    setPeerTyping(false);
  }, [activeConversationId]);

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

  const starChat = useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) =>
      updateAdminConversation(id, { starred }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const bulkChats = useMutation({
    mutationFn: (input: { ids: string[]; action: 'delete' | 'star' | 'unstar' }) =>
      bulkAdminConversations(input),
    onSuccess: (_res, input) => {
      setSelected([]);
      if (input.action === 'delete' && input.ids.includes(activeConversationId ?? '')) {
        navigate('/admin/messages/customers');
      }
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversation'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
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

  function toggleSelected(id: string) {
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function toggleAll() {
    const ids = pagedConversations.map((c) => c.id);
    const allOnPage = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((current) =>
      allOnPage ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])],
    );
  }

  async function confirmBulkDelete() {
    if (selected.length === 0) return;
    const ok = await dialog.confirm({
      title: `Delete ${selected.length} chat${selected.length === 1 ? '' : 's'}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    bulkChats.mutate({ ids: selected, action: 'delete' });
  }

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

  const helpThread = isHelpRequest(active) || isHelpRequest(listedActive);
  const displayName = helpThread
    ? helpRequestTitle(active?.orderRef ?? listedActive?.orderRef)
    : hideCustomerDetails
      ? active
        ? inboxTitle(active, true)
        : 'Conversation'
      : active?.customerName?.trim() ||
        listedActive?.customerName?.trim() ||
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
      <div className="msg-workspace portal portal-thread admin-thread">
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
              <div className="on">
                <span className="portal-thread-name">{displayName}</span>
                {helpThread && <HelpRequestBadge />}
              </div>
              {workLine && <div className="om">{workLine}</div>}
            </div>
            {active && (
              <div className="msg-center-actions">
                {orderChatId && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={revisionOpen && (revisionOrderQ.isLoading || revisionTeamQ.isFetching)}
                    onClick={() => {
                      setError(null);
                      setRevisionOpen(true);
                    }}
                  >
                    <i className="ti ti-refresh" />
                    {revisionOpen && (revisionOrderQ.isLoading || revisionTeamQ.isFetching)
                      ? 'Opening…'
                      : 'Create revision'}
                  </button>
                )}
                {canBill && customerId && customerId !== 'unknown' && !hideCustomerDetails && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setError(null);
                      setInvoiceOpen(true);
                    }}
                  >
                    <i className="ti ti-file-invoice" /> Generate invoice
                  </button>
                )}
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
                                subject: o.humanRef ? `Order ${orderNumber(o.humanRef)} Chat` : 'Order Chat',
                              })
                            }
                          >
                            <i className="ti ti-package" /> Order {orderNumber(o.humanRef, o.id.slice(0, 6))}
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
                                    ? `Quotation ${orderNumber(o.humanRef)} Chat`
                                    : 'Quotation Chat',
                                })
                              }
                            >
                              <i className="ti ti-file-invoice" /> Quote {orderNumber(o.humanRef, o.id.slice(0, 6))}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
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
                typing={peerTyping}
              />
              {!canReply && active.status === 'OPEN' && (
                <div className="muted" style={{ margin: '0 12px 8px', fontSize: 12.5 }}>
                  You don’t have permission to reply in customer chats.
                </div>
              )}
              {revisionToast && (
                <div className="toast show">
                  <i className="ti ti-circle-check" /> {revisionToast}
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
                onTyping={(on) => emitConversationTyping(active.id, on)}
                onSend={async (body, files) => {
                  await sendMutation.mutateAsync({ body, files });
                }}
              />
            </>
          )}
        </section>
        <aside className="msg-right admin-thread-side" aria-label="Customer details">
          <div className="msg-right-body">
            <div className="msg-right-section">
              <div className="msg-right-title">Customer</div>
              {hideCustomerDetails ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Customer details are hidden for this role.
                </p>
              ) : (
                <>
                  <div className="msg-cust-hero">
                    <div className="thumb" aria-hidden>
                      {initials(displayName)}
                    </div>
                    <div className="msg-cust-hero-text">
                      <b>{displayName}</b>
                      {customerId && customerId !== 'unknown' && (
                        <Link to={`/admin/customers?open=${customerId}`}>
                          View profile
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="msg-kv">
                    <span>Email</span>
                    <b>
                      {contextQuery.data?.customer.email ||
                        active?.customerEmail ||
                        '—'}
                    </b>
                  </div>
                  <div className="msg-kv">
                    <span>Phone</span>
                    <b>
                      {contextQuery.data?.customer.phone ||
                        active?.customerPhone ||
                        '—'}
                    </b>
                  </div>
                  <div className="msg-kv">
                    <span>Account</span>
                    <b>{accountTypeLabel(contextQuery.data?.customer.accountType)}</b>
                  </div>
                  <div className="msg-kv">
                    <span>Customer since</span>
                    <b>
                      {sinceLabel(
                        contextQuery.data?.customer.customerSince ||
                          contextQuery.data?.customer.createdAt,
                      )}
                    </b>
                  </div>
                  <div className="msg-kv">
                    <span>Orders</span>
                    <b>{contextQuery.data?.customer.totalOrders ?? '—'}</b>
                  </div>
                  <div className="msg-kv">
                    <span>Total spent</span>
                    <b>{money(contextQuery.data?.customer.totalSpentCents)}</b>
                  </div>
                </>
              )}
            </div>
            <div className="msg-right-section">
              <div className="msg-right-title">Order history</div>
              {contextQuery.isLoading && (
                <div className="muted" style={{ fontSize: 13 }}>Loading orders…</div>
              )}
              {!contextQuery.isLoading &&
                (contextQuery.data?.recentOrders ?? []).length === 0 && (
                  <div className="muted" style={{ fontSize: 13 }}>No orders yet.</div>
                )}
              <div className="msg-order-scroll">
                {(contextQuery.data?.recentOrders ?? []).slice(0, 15).map((o) => (
                  <Link key={o.id} to={`/admin/orders/${orderSlug(o.humanRef, o.id)}`} className="msg-order-row">
                    <div>
                      <b>{o.humanRef ? `Order ${orderNumber(o.humanRef)}` : 'Order'}</b>
                      <div className="msg-order-date">{dateShort(o.createdAt)}</div>
                    </div>
                    <div className="msg-order-meta">
                      {!hideCustomerDetails && o.totalCents != null && (
                        <b>{money(o.totalCents)}</b>
                      )}
                      <span className={statusChipClass(o.status)}>
                        {statusLabel(o.status, 'admin')}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
          {active && (
            <div className="msg-right-section msg-right-notes">
              <label className="msg-right-title" htmlFor="admin-private-notes">
                Private notes
              </label>
              <textarea
                id="admin-private-notes"
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
        </aside>
        {revisionOpen && revisionOrderQ.data && revisionTeamQ.isFetched && orderChatId && (
          <RevisionModal
            key={orderChatId}
            orderRef={orderNumber(
              revisionOrderQ.data.order.humanRef,
              revisionOrderQ.data.order.id.slice(0, 6),
            )}
            defaultDesignerId={revisionOrderQ.data.order.assignedDesignerId ?? ''}
            designers={(revisionTeamQ.data?.members ?? [])
              .filter((member) => member.role === 'DESIGNER')
              .map((member) => ({
                id: member.id,
                firstName: member.firstName,
                email: member.email,
                skills: member.skills,
              }))}
            designs={(revisionOrderQ.data.order as Order & { designs?: Design[] }).designs ?? []}
            initialNote={latestCustomerAsk(active?.messages)}
            onClose={() => setRevisionOpen(false)}
            onSubmit={async (data) => {
              await createAdminEdit(orderChatId, data);
              setRevisionOpen(false);
              setRevisionToast('Revision started on this order.');
              void qc.invalidateQueries({ queryKey: ['admin-order-edits', orderChatId] });
              void qc.invalidateQueries({ queryKey: ['admin-order', orderChatId] });
            }}
          />
        )}
        {invoiceOpen && customerId && customerId !== 'unknown' && (
          <CreateInvoiceModal
            lockedCustomer={{
              id: customerId,
              name: displayName,
              email: active?.customerEmail ?? contextQuery.data?.customer.email ?? null,
            }}
            onClose={() => setInvoiceOpen(false)}
            onCreated={() => setRevisionToast('Invoice created')}
          />
        )}
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

      <InboxBulkBar
        selectedCount={selected.length}
        totalCount={pagedConversations.length}
        allSelected={
          pagedConversations.length > 0 &&
          pagedConversations.every((c) => selected.includes(c.id))
        }
        onToggleAll={toggleAll}
        onDelete={() => void confirmBulkDelete()}
        deleting={bulkChats.isPending}
      />

      <div className="card">
        {listQuery.isLoading && <SkeletonRows rows={6} />}
        {!listQuery.isLoading && conversations.length === 0 && (
          <EmptyState
            icon="ti-inbox"
            title={q.trim() || filter !== 'all' ? 'No matching conversations' : 'No conversations yet'}
            description="Chats show up here when a customer messages you from a quote, order, or the inbox."
          />
        )}
        {pagedConversations.map((c) => {
          const name = inboxTitle(c, hideCustomerDetails);
          const refLabel = conversationRefLabel(c);
          const help = isHelpRequest(c);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`orow inbox-row${selected.includes(c.id) ? ' is-selected' : ''}`}
              onClick={() => openConvo(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openConvo(c);
                }
              }}
            >
              <label className="inbox-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggleSelected(c.id)}
                  aria-label={`Select ${name}`}
                />
              </label>
              <InboxStarButton
                on={isStarred(c, 'admin')}
                onClick={() =>
                  starChat.mutate({ id: c.id, starred: !isStarred(c, 'admin') })
                }
              />
              <div className="thumb">
                {hideCustomerDetails ? (
                  <i className="ti ti-package" />
                ) : (
                  initials(name)
                )}
              </div>
              <div className="oinfo inbox-main">
                <span className="on">{name}</span>
                <div className="inbox-center">
                  <span className="inbox-snippet">
                    {c.lastMessagePreview || 'No messages yet'}
                  </span>
                  {(help || (refLabel && !hideCustomerDetails)) && (
                    <div className="inbox-center-sub">
                      {help && <HelpRequestBadge />}
                      {refLabel && !hideCustomerDetails && (
                        <span className="inbox-order">{refLabel}</span>
                      )}
                    </div>
                  )}
                </div>
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
      <PaginationBar
        page={currentPage}
        totalPages={totalPages}
        total={conversations.length}
        onPage={setPage}
      />
      </div>
    </div>
  );
}
