import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '@/components/ui/AppDialog';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { HelpRequestBadge, InboxStarButton } from '@/components/messaging/InboxTools';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { getErrorMessage } from '@/lib/api';
import { whenVisible } from '@/lib/queryRefresh';
import {
  sortConversationsNewestFirst,
  createMyConversation,
  deleteMyConversation,
  getMyConversation,
  isHelpRequest,
  isStarred,
  listMyConversations,
  sendMyMessage,
  updateMyConversation,
  type Conversation,
} from '@/lib/messaging';
import {
  maybeRequestBrowserNotifications,
  showBrowserNotification,
  useMessagingSocket,
} from '@/hooks/useMessagingSocket';

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

function conversationContext(c: Conversation) {
  if (c.label === 'EDIT' && c.orderRef) return `Revision ${c.orderRef}`;
  if (c.chatType === 'QUOTE' && c.orderRef) return `Quote ${c.orderRef}`;
  if (c.orderRef) return `Order ${c.orderRef}`;
  return null;
}

function conversationKind(c: Conversation): 'order' | 'quote' | 'revision' | 'general' {
  if (c.label === 'EDIT') return 'revision';
  if (c.chatType === 'QUOTE') return 'quote';
  if (c.chatType === 'ORDER') return 'order';
  return 'general';
}

const TYPE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'order', label: 'Orders' },
  { id: 'quote', label: 'Quotes' },
  { id: 'revision', label: 'Revisions' },
] as const;

export function PortalMessages() {
  const dialog = useDialog();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [inboxFilter, setInboxFilter] = useState<'all' | 'unread' | 'starred' | 'archived'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'order' | 'quote' | 'revision'>('all');
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const conversationId = searchParams.get('c');

  const convosQuery = useQuery({
    queryKey: ['my-conversations'],
    queryFn: listMyConversations,
    refetchInterval: whenVisible(20_000),
  });

  const allConversations = useMemo(
    () => sortConversationsNewestFirst(convosQuery.data?.conversations ?? []),
    [convosQuery.data?.conversations],
  );
  const conversations = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allConversations.filter((c) => {
      const archived = Boolean(c.archived);
      if (inboxFilter === 'archived') {
        if (!archived) return false;
      } else if (archived) {
        return false;
      }
      if (inboxFilter === 'starred' && !isStarred(c, 'client')) return false;
      if (inboxFilter === 'unread' && !(c.unreadClient > 0)) return false;
      if (typeFilter !== 'all' && conversationKind(c) !== typeFilter) return false;
      if (!term) return true;
      const ref = conversationContext(c) || '';
      const hay = `${ref} ${c.orderRef || ''} ${c.lastMessagePreview || ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [allConversations, q, inboxFilter, typeFilter]);

  const unreadCount = allConversations.filter((c) => !c.archived && c.unreadClient > 0).length;

  useEffect(() => {
    function onDoc() {
      setMenuFor(null);
    }
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const threadQuery = useQuery({
    queryKey: ['my-conversation', conversationId],
    queryFn: () => getMyConversation(conversationId as string),
    enabled: !!conversationId,
    refetchInterval: whenVisible(15_000),
  });

  useMessagingSocket({
    conversationId,
    onMessageNew: (payload) => {
      const p = payload as { message?: { body?: string } };
      showBrowserNotification('New Message', p.message?.body);
      if (conversationId) {
        void qc.invalidateQueries({ queryKey: ['my-conversation', conversationId] });
      }
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
    },
  });

  const active = threadQuery.data?.conversation;

  const sendMutation = useMutation({
    mutationFn: ({ body, files }: { body: string; files: File[] }) =>
      sendMyMessage(conversationId as string, body, files),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['my-conversation', conversationId] });
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const startTopic = useMutation({
    mutationFn: () => createMyConversation({ chatType: 'GENERAL' }),
    onSuccess: (res) => {
      setSearchParams({ c: res.conversation.id });
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const starChat = useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) =>
      updateMyConversation(id, { starred }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const deleteTopic = useMutation({
    mutationFn: (id: string) => deleteMyConversation(id),
    onSuccess: (_res, id) => {
      setError(null);
      if (conversationId === id) setSearchParams({}, { replace: true });
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
      void qc.invalidateQueries({ queryKey: ['my-conversation', id] });
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  useEffect(() => {
    if (!typeOpen) return;
    function onDoc(e: MouseEvent) {
      if (!typeRef.current?.contains(e.target as Node)) setTypeOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTypeOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [typeOpen]);

  function selectConvo(c: Conversation) {
    setSearchParams({ c: c.id });
    maybeRequestBrowserNotifications();
  }

  function backToInbox() {
    setSearchParams({}, { replace: true });
    setError(null);
  }

  async function confirmDelete(id: string) {
    const ok = await dialog.confirm({
      title: 'Delete this chat?',
      message: 'It will be removed from your list.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteTopic.mutate(id);
  }

  const startActions = (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => startTopic.mutate()}
      disabled={startTopic.isPending}
    >
      <i className="ti ti-plus" />
      {startTopic.isPending ? 'Starting…' : 'Start New Conversation'}
    </button>
  );

  if (conversationId) {
    const threadContext = active ? conversationContext(active) : null;
    return (
      <div className="msg-workspace portal portal-thread">
        <section className="msg-center">
          <div className="msg-center-head portal-thread-head">
            <button
              type="button"
              className="icon-btn"
              aria-label="Back to messages"
              onClick={backToInbox}
            >
              <i className="ti ti-arrow-left" />
            </button>
            <div className="portal-thread-title">
              <div className="on">
                <span className="portal-thread-name">
                  {active ? conversationContext(active) || 'New conversation' : 'Conversation'}
                </span>
                {isHelpRequest(active) && <HelpRequestBadge />}
              </div>
              {threadContext && <div className="om">{threadContext}</div>}
            </div>
            {active && (
              <button
                type="button"
                className="icon-btn danger"
                aria-label="Delete chat"
                disabled={deleteTopic.isPending}
                onClick={() => confirmDelete(active.id)}
              >
                <i className="ti ti-trash" />
              </button>
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
              description="It may have been removed."
              action={
                <button type="button" className="btn btn-ghost btn-sm" onClick={backToInbox}>
                  Back to messages
                </button>
              }
            />
          )}
          {active && (
            <>
              <ConversationThread
                messages={active.messages ?? []}
                mineDirection="INBOUND"
              />
              <MessageComposer
                onSend={async (body, files) => {
                  await sendMutation.mutateAsync({ body, files });
                }}
              />
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Chat with our team about your orders, quotes and revisions."
        actions={startActions}
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {convosQuery.isError && (
        <ErrorBanner>{getErrorMessage(convosQuery.error)}</ErrorBanner>
      )}

      <div className="inbox-toolbar">
        <div className="searchbar inbox-search">
          <i className="ti ti-search si" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => maybeRequestBrowserNotifications()}
            placeholder="Search by reference number or message"
            aria-label="Search conversations"
          />
        </div>
        <div className="inbox-filters">
          {(['all', 'unread', 'starred', 'archived'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`chip-btn${inboxFilter === id ? ' on' : ''}`}
              onClick={() => setInboxFilter(id)}
            >
              {id === 'all' ? 'All' : id === 'unread' ? 'Unread' : id === 'starred' ? 'Starred' : 'Archived'}
            </button>
          ))}
        </div>
        <div className="inbox-type" ref={typeRef}>
          <button
            type="button"
            className={`inbox-type-btn${typeOpen ? ' open' : ''}`}
            aria-label="Conversation type"
            aria-expanded={typeOpen}
            aria-haspopup="listbox"
            onClick={() => setTypeOpen((open) => !open)}
          >
            <span>Type</span>
            <strong>{TYPE_OPTIONS.find((o) => o.id === typeFilter)?.label ?? 'All'}</strong>
            <i className="ti ti-chevron-down" aria-hidden />
          </button>
          {typeOpen && (
            <div className="inbox-type-menu" role="listbox" aria-label="Conversation type">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={typeFilter === opt.id}
                  className={typeFilter === opt.id ? 'on' : undefined}
                  onClick={() => {
                    setTypeFilter(opt.id);
                    setTypeOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">Conversations</span>
          {unreadCount > 0 && <span className="msg-unread-count">{unreadCount} unread</span>}
        </div>
        {convosQuery.isLoading && <SkeletonRows rows={5} />}
        {!convosQuery.isLoading && !convosQuery.isError && conversations.length === 0 && (
          <EmptyState
            icon="ti-message"
            title={q.trim() ? 'No matching conversations' : 'No conversations yet'}
            description={
              q.trim()
                ? 'Try a different search, or start a new conversation.'
                : 'Start a new conversation, or open chat from a quote or order.'
            }
            action={
              !q.trim() ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => startTopic.mutate()}
                >
                  <i className="ti ti-plus" /> Start New Conversation
                </button>
              ) : undefined
            }
          />
        )}
        {conversations.map((c) => {
          const context = conversationContext(c);
          const starred = isStarred(c, 'client');
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`orow inbox-row msg-compact${c.unreadClient > 0 ? ' is-unread' : ''}`}
              onClick={() => selectConvo(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectConvo(c);
                }
              }}
            >
              <InboxStarButton
                on={starred}
                onClick={() => starChat.mutate({ id: c.id, starred: !starred })}
              />
              <div className="oinfo msg-compact-main">
                <span className="on">{context || 'New conversation'}</span>
                <span className="om inbox-snippet">{c.lastMessagePreview || 'No messages yet'}</span>
                <span className="msg-time">{inboxTime(c.lastMessageAt)}</span>
              </div>
              {c.unreadClient > 0 && <span className="msg-dot" aria-label="Unread" />}
              <div className="msg-kebab" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="msg-kebab-btn"
                  aria-label="Conversation actions"
                  onClick={() => setMenuFor((id) => (id === c.id ? null : c.id))}
                >
                  <i className="ti ti-dots-vertical" />
                </button>
                {menuFor === c.id && (
                  <div className="msg-menu" role="menu">
                    <button
                      type="button"
                      onClick={() => {
                        starChat.mutate({ id: c.id, starred: !starred });
                        setMenuFor(null);
                      }}
                    >
                      {starred ? 'Unstar conversation' : 'Star conversation'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void updateMyConversation(c.id, { unread: c.unreadClient === 0 }).then(() => {
                          void qc.invalidateQueries({ queryKey: ['my-conversations'] });
                          void qc.invalidateQueries({ queryKey: ['portal-unread'] });
                        });
                        setMenuFor(null);
                      }}
                    >
                      {c.unreadClient > 0 ? 'Mark as read' : 'Mark as unread'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void updateMyConversation(c.id, { archived: !c.archived }).then(() => {
                          void qc.invalidateQueries({ queryKey: ['my-conversations'] });
                        });
                        setMenuFor(null);
                      }}
                    >
                      {c.archived ? 'Unarchive' : 'Archive'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
