import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/api';
import { getMyCustomer } from '@/lib/customers';
import {
  createMyConversation,
  getMyConversation,
  listMyConversations,
  sendMyMessage,
} from '@/lib/messaging';

function formatMsgTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function PortalMessages() {
  const qc = useQueryClient();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: meCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const isNet = meCustomer?.customer?.accountType === 'NET_MONTHLY';

  const convosQuery = useQuery({
    queryKey: ['my-conversations'],
    queryFn: listMyConversations,
    refetchInterval: 15000,
  });

  const startedRef = useRef(false);

  const createConvo = useMutation({
    mutationFn: () => createMyConversation({ subject: 'Team chat' }),
    onSuccess: (res) => {
      setConversationId(res.conversation.id);
      qc.invalidateQueries({ queryKey: ['my-conversations'] });
    },
  });

  useEffect(() => {
    if (conversationId) return;
    const convos = convosQuery.data?.conversations ?? [];
    if (convos.length > 0) {
      setConversationId(convos[0].id);
      return;
    }
    if (!convosQuery.isLoading && !startedRef.current) {
      startedRef.current = true;
      createConvo.mutate();
    }
  }, [convosQuery.data, convosQuery.isLoading, conversationId, createConvo]);

  const threadQuery = useQuery({
    queryKey: ['my-conversation', conversationId],
    queryFn: () => getMyConversation(conversationId as string),
    enabled: !!conversationId,
    refetchInterval: 15000,
  });

  const messages = threadQuery.data?.conversation.messages ?? [];

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendMyMessage(conversationId as string, body),
    onSuccess: () => {
      setDraft('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['my-conversation', conversationId] });
      qc.invalidateQueries({ queryKey: ['my-conversations'] });
      qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  function handleSend() {
    const body = draft.trim();
    if (!body || !conversationId) return;
    sendMutation.mutate(body);
  }

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Messages</h1>
          <div className="sub">
            Chat directly with our team. Ask a question, send new details, or request a change —
            we usually reply within a couple of hours.
          </div>
        </div>
      </div>

      {isNet && (
        <div className="approve-banner" style={{ marginTop: 20 }}>
          <i className="ti ti-shield-check" />
          <div>
            <div className="abt">Trade account — approved for monthly billing</div>
            <div className="abs">
              Your account is approved by our team for net-monthly terms. New logos you send are
              added straight to this month&apos;s order without a per-order quote. Reach out here
              anytime to adjust your terms or credit limit.
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="alert-error" style={{ margin: `${isNet ? 14 : 20}px 0` }}>
          {error}
        </div>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="chat">
          <div className="chat-body" ref={bodyRef}>
            {threadQuery.isLoading && (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading conversation…</div>
            )}
            {!threadQuery.isLoading && messages.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                Say hello — our team usually replies within a couple of hours.
              </div>
            )}
            {messages.map((m) => {
              const mine = m.direction === 'INBOUND';
              return (
                <div key={m.id} className={`msg ${mine ? 'me' : 'them'}`}>
                  {m.body}
                  <div className="mt">
                    {mine ? 'You' : 'LVD team'} · {formatMsgTime(m.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="chat-in">
            <input
              placeholder="Type a message, or attach an image…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              type="button"
              className="send"
              disabled={!draft.trim() || sendMutation.isPending}
              onClick={handleSend}
            >
              <i className="ti ti-send" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
