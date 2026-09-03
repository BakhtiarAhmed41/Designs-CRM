import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '@/components/ui/AppDialog';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { getErrorMessage } from '@/lib/api';
import { whenVisible } from '@/lib/queryRefresh';
import {
  chatTypeLabel,
  conversationTitle,
  createMyConversation,
  deleteMyConversation,
  getMyConversation,
  listMyConversations,
  sendMyMessage,
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
  const [topicDraft, setTopicDraft] = useState('');
  const [topicFormOpen, setTopicFormOpen] = useState(false);
  const conversationId = searchParams.get('c');

  const convosQuery = useQuery({
    queryKey: ['my-conversations'],
    queryFn: listMyConversations,
    refetchInterval: whenVisible(20_000),
  });

  const conversations = useMemo(() => {
    const all = convosQuery.data?.conversations ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all.filter((c) => {
      const hay = `${conversationTitle(c)} ${c.subject || ''} ${c.orderRef || ''} ${chatTypeLabel(c.chatType)} ${c.lastMessagePreview || ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [convosQuery.data?.conversations, q]);

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
    mutationFn: (subject: string) =>
      createMyConversation({ chatType: 'GENERAL', subject }),
    onSuccess: (res) => {
      setTopicFormOpen(false);
      setTopicDraft('');
      setSearchParams({ c: res.conversation.id });
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

  const startActions = !topicFormOpen ? (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => setTopicFormOpen(true)}
      disabled={startTopic.isPending}
    >
      <i className="ti ti-plus" />
      Start New Conversation
    </button>
  ) : null;

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
                {active ? conversationTitle(active) : 'Conversation'}
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

      {topicFormOpen && (
        <form
          className="card inbox-start-card"
          onSubmit={(e) => {
            e.preventDefault();
            const subject = topicDraft.trim();
            if (!subject) return;
            startTopic.mutate(subject);
          }}
        >
          <label className="inbox-start-label" htmlFor="new-conversation-topic">
            What is this about?
          </label>
          <input
            id="new-conversation-topic"
            className="inbox-start-input"
            autoFocus
            placeholder="e.g. Question about a file format"
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            maxLength={120}
          />
          <div className="inbox-start-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setTopicFormOpen(false);
                setTopicDraft('');
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!topicDraft.trim() || startTopic.isPending}
            >
              {startTopic.isPending ? 'Starting…' : 'Start Conversation'}
            </button>
          </div>
        </form>
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

      <div className="card">
        {convosQuery.isLoading && <SkeletonRows rows={5} />}
        {!convosQuery.isLoading && conversations.length === 0 && (
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
                  onClick={() => setTopicFormOpen(true)}
                >
                  <i className="ti ti-plus" /> Start New Conversation
                </button>
              ) : undefined
            }
          />
        )}
        {conversations.map((c) => {
          const context = conversationContext(c);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className="orow inbox-row"
              onClick={() => selectConvo(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectConvo(c);
                }
              }}
            >
              <div className="thumb">
                <i className="ti ti-message" />
              </div>
              <div className="oinfo">
                <div className="on">{conversationTitle(c)}</div>
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
