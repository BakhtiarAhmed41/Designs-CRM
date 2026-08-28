import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { getErrorMessage } from '@/lib/api';
import { whenVisible } from '@/lib/queryRefresh';
import { dateShort } from '@/lib/format';
import {
  chatTypeLabel,
  conversationTitle,
  createMyConversation,
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

export function PortalMessages() {
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

  useEffect(() => {
    if (conversationId || convosQuery.isLoading) return;
    const all = convosQuery.data?.conversations ?? [];
    if (all.length > 0) {
      setSearchParams({ c: all[0].id }, { replace: true });
    }
  }, [conversationId, convosQuery.data?.conversations, convosQuery.isLoading, setSearchParams]);

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

  function selectConvo(c: Conversation) {
    setSearchParams({ c: c.id });
    maybeRequestBrowserNotifications();
  }

  return (
    <div className="msg-workspace portal">
      <aside className="msg-left">
        <div className="msg-left-head">
          <div className="h2" style={{ margin: 0 }}>Messages</div>
          <input
            className="msg-search"
            placeholder="Search chats…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => maybeRequestBrowserNotifications()}
          />
          {!topicFormOpen ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 10 }}
              onClick={() => setTopicFormOpen(true)}
              disabled={startTopic.isPending}
            >
              <i className="ti ti-message" />
              Start new chat
            </button>
          ) : (
            <form
              className="msg-topic-form"
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                const subject = topicDraft.trim();
                if (!subject) return;
                startTopic.mutate(subject);
              }}
            >
              <input
                className="msg-search"
                style={{ marginTop: 0 }}
                autoFocus
                placeholder="What’s this about?"
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
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!topicDraft.trim() || startTopic.isPending}
                >
                  {startTopic.isPending ? 'Starting…' : 'Start'}
                </button>
              </div>
            </form>
          )}
        </div>
        <div className="msg-left-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`msg-cust-card ${c.id === conversationId ? 'on' : ''}`}
              onClick={() => selectConvo(c)}
            >
              <div className="msg-cust-main" style={{ width: '100%' }}>
                <div className="msg-cust-top">
                  <strong>{conversationTitle(c)}</strong>
                  <span>{relativeTime(c.lastMessageAt)}</span>
                </div>
                <div className="msg-cust-preview">
                  {c.lastMessagePreview || 'No messages yet'}
                </div>
                <div className="msg-cust-meta">
                  {c.chatType === 'GENERAL' && (
                    <span className="msg-type">{chatTypeLabel(c.chatType)}</span>
                  )}
                  {c.unreadClient > 0 && (
                    <span className="msg-badge">{c.unreadClient}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
          {!convosQuery.isLoading && conversations.length === 0 && (
            <div className="msg-empty-state">
              <div className="empty-state-title">No conversations yet</div>
              <p className="empty-state-desc">Start a topic or open chat from an order or quote.</p>
            </div>
          )}
        </div>
      </aside>

      <section className="msg-center">
        {active ? (
          <>
            <div className="msg-center-head">
              <div>
                <div className="h2" style={{ margin: 0 }}>
                  {conversationTitle(active)}
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                  {active.status === 'OPEN' ? 'Open' : 'Closed'}
                </div>
              </div>
            </div>
            {error && <div className="err" style={{ margin: '0 12px' }}>{error}</div>}
            <ConversationThread
              messages={active?.messages ?? []}
              mineDirection="INBOUND"
            />
            <MessageComposer
              onSend={async (body, files) => {
                await sendMutation.mutateAsync({ body, files });
              }}
            />
          </>
        ) : (
          <div className="msg-empty-state">
            Select a conversation or start a new topic chat.
          </div>
        )}
      </section>
    </div>
  );
}
