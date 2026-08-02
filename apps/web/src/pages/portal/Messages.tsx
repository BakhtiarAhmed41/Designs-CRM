import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationThread } from '@/components/messaging/ConversationThread';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { getErrorMessage } from '@/lib/api';
import { dateShort } from '@/lib/format';
import {
  chatTypeLabel,
  createMyConversation,
  getMyConversation,
  listMyConversations,
  sendMyMessage,
  type ChatType,
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
  const conversationId = searchParams.get('c');

  const convosQuery = useQuery({
    queryKey: ['my-conversations'],
    queryFn: listMyConversations,
    refetchInterval: 20_000,
  });

  const conversations = convosQuery.data?.conversations ?? [];

  useEffect(() => {
    if (conversationId || convosQuery.isLoading) return;
    if (conversations.length > 0) {
      setSearchParams({ c: conversations[0].id }, { replace: true });
    }
  }, [conversationId, conversations, convosQuery.isLoading, setSearchParams]);

  const threadQuery = useQuery({
    queryKey: ['my-conversation', conversationId],
    queryFn: () => getMyConversation(conversationId as string),
    enabled: !!conversationId,
    refetchInterval: 15_000,
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
  const linkedSummary = useMemo(() => {
    if (!active) return null;
    if (active.chatType === 'GENERAL') return 'General inquiry';
    return `${chatTypeLabel(active.chatType)}${active.orderRef ? ` · ${active.orderRef}` : ''}`;
  }, [active]);

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

  const startGeneral = useMutation({
    mutationFn: () =>
      createMyConversation({ chatType: 'GENERAL', subject: 'General Inquiry' }),
    onSuccess: (res) => {
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
          <button
            type="button"
            className="primary"
            style={{ width: '100%', marginTop: 10 }}
            onClick={() => startGeneral.mutate()}
            disabled={startGeneral.isPending}
          >
            Start New Inquiry
          </button>
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
                  <strong>
                    {chatTypeLabel(c.chatType as ChatType)}
                    {c.orderRef ? ` ${c.orderRef}` : ''}
                  </strong>
                  <span>{relativeTime(c.lastMessageAt)}</span>
                </div>
                <div className="msg-cust-preview">
                  {c.lastMessagePreview || c.subject || 'No messages yet'}
                </div>
                <div className="msg-cust-meta">
                  <span className="msg-type">{c.status}</span>
                  {c.unreadClient > 0 && (
                    <span className="msg-badge">{c.unreadClient}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
          {!convosQuery.isLoading && conversations.length === 0 && (
            <div className="msg-empty">
              No conversations yet. Start a general inquiry or open chat from an order/quote.
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
                  {active.subject || chatTypeLabel(active.chatType)}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {linkedSummary}
                  {active.orderStatus ? ` · ${active.orderStatus}` : ''}
                </div>
              </div>
            </div>
            <ConversationThread
              messages={active.messages}
              mineDirection="INBOUND"
              emptyText="Say hello — our team will reply here."
            />
            {error && <div className="err" style={{ margin: '0 12px' }}>{error}</div>}
            <MessageComposer
              disabled={active.status === 'CLOSED'}
              placeholder={
                active.status === 'CLOSED'
                  ? 'This conversation is closed'
                  : 'Write a message…'
              }
              onSend={async (body, files) => {
                await sendMutation.mutateAsync({ body, files });
              }}
            />
          </>
        ) : (
          <div className="msg-empty-state">
            Select a conversation or start a new inquiry.
          </div>
        )}
      </section>
    </div>
  );
}
