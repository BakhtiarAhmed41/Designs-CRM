import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '@/components/ui/AppDialog';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { HelpRequestBadge, InboxBulkBar, InboxStarButton } from '@/components/messaging/InboxTools';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { getErrorMessage } from '@/lib/api';
import { whenVisible } from '@/lib/queryRefresh';
import {
  chatTypeLabel,
  conversationInboxNumbers,
  customerChatTitle,
  sortConversationsNewestFirst,
  bulkMyConversations,
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
  if (c.orderRef) {
    return c.chatType === 'QUOTE' ? `Quote ${c.orderRef}` : `Order ${c.orderRef}`;
  }
  return null;
}

export function PortalMessages() {
  const dialog = useDialog();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showStarred, setShowStarred] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
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
  const inboxNumbers = useMemo(
    () => conversationInboxNumbers(allConversations),
    [allConversations],
  );

  const conversations = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allConversations.filter((c) => {
      if (showStarred && !isStarred(c, 'client')) return false;
      if (!term) return true;
      const title = customerChatTitle(c, inboxNumbers.get(c.id));
      const hay = `${title} ${c.subject || ''} ${c.orderRef || ''} ${chatTypeLabel(c.chatType)} ${c.lastMessagePreview || ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [allConversations, inboxNumbers, q, showStarred]);

  useEffect(() => {
    setSelected((ids) => {
      const next = ids.filter((id) => conversations.some((c) => c.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [conversations]);

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
      showBrowserNotification('New message from our team', p.message?.body);
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

  const bulkChats = useMutation({
    mutationFn: (input: { ids: string[]; action: 'delete' | 'star' | 'unstar' }) =>
      bulkMyConversations(input),
    onSuccess: (_res, input) => {
      setSelected([]);
      if (input.action === 'delete' && input.ids.includes(conversationId ?? '')) {
        setSearchParams({}, { replace: true });
      }
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
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

  function selectConvo(c: Conversation) {
    setSearchParams({ c: c.id });
    maybeRequestBrowserNotifications();
  }

  function backToInbox() {
    setSearchParams({}, { replace: true });
    setError(null);
  }

  function toggleSelected(id: string) {
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function toggleAll() {
    setSelected((ids) =>
      ids.length === conversations.length ? [] : conversations.map((c) => c.id),
    );
  }

  async function confirmBulkDelete() {
    if (selected.length === 0) return;
    const ok = await dialog.confirm({
      title: `Delete ${selected.length} chat${selected.length === 1 ? '' : 's'}?`,
      message: 'They will be removed from your list.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    bulkChats.mutate({ ids: selected, action: 'delete' });
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
                  {active
                    ? customerChatTitle(active, inboxNumbers.get(active.id))
                    : 'Conversation'}
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
        subtitle="Chat with the team about a quote, order, or anything else."
        actions={startActions}
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {convosQuery.isError && (
        <ErrorBanner>{getErrorMessage(convosQuery.error)}</ErrorBanner>
      )}

      <div className="searchbar inbox-search">
        <i className="ti ti-search si" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => maybeRequestBrowserNotifications()}
          placeholder="Search conversations…"
          aria-label="Search conversations"
        />
      </div>

      <div className="inbox-filters">
        <button
          type="button"
          className={`chip-btn${showStarred ? '' : ' on'}`}
          onClick={() => setShowStarred(false)}
        >
          Inbox
        </button>
        <button
          type="button"
          className={`chip-btn${showStarred ? ' on' : ''}`}
          onClick={() => setShowStarred(true)}
        >
          Starred
        </button>
      </div>

      <InboxBulkBar
        selectedCount={selected.length}
        totalCount={conversations.length}
        onToggleAll={toggleAll}
        onDelete={() => void confirmBulkDelete()}
        deleting={bulkChats.isPending}
      />

      <div className="card">
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
        {conversations.map((c, index) => {
          const context = conversationContext(c);
          const number = inboxNumbers.get(c.id) ?? index + 1;
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`orow inbox-row${selected.includes(c.id) ? ' is-selected' : ''}`}
              onClick={() => selectConvo(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectConvo(c);
                }
              }}
            >
              <label className="inbox-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggleSelected(c.id)}
                  aria-label={`Select ${customerChatTitle(c, number)}`}
                />
              </label>
              <InboxStarButton
                on={isStarred(c, 'client')}
                onClick={() =>
                  starChat.mutate({ id: c.id, starred: !isStarred(c, 'client') })
                }
              />
              <div className="thumb inbox-index" aria-hidden>
                {number}
              </div>
              <div className="oinfo">
                <div className="on inbox-title-row">
                  <span>{customerChatTitle(c, number)}</span>
                  {isHelpRequest(c) && <HelpRequestBadge />}
                </div>
                {context && <div className="om">{context}</div>}
                <div className="om inbox-snippet">
                  {c.lastMessagePreview || 'No messages yet'}
                </div>
              </div>
              <div className="inbox-meta">
                <span>{inboxTime(c.lastMessageAt)}</span>
                {c.unreadClient > 0 && (
                  <span className="msg-badge">{c.unreadClient}</span>
                )}
              </div>
              <i className="ti ti-chevron-right inbox-chevron" aria-hidden />
            </div>
          );
        })}
        {!convosQuery.isLoading && conversations.length > 0 && (
          <div className="inbox-hint">Select a conversation to view messages.</div>
        )}
      </div>
    </div>
  );
}
