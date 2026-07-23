import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/api';
import {
  getTeamChat,
  sendTeamChat,
  type TeamChatMessage,
  type TeamMember,
} from '@/lib/team';

export function TeamChatPanel({
  peerId,
  onClose,
}: {
  peerId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['team-chat', peerId],
    queryFn: () => getTeamChat(peerId),
    refetchInterval: 5_000,
    enabled: !!peerId,
  });

  const peer = data?.peer as TeamMember | undefined;
  const messages = (data?.messages ?? []) as TeamChatMessage[];
  const peerName =
    [peer?.firstName, peer?.lastName].filter(Boolean).join(' ') ||
    peer?.email ||
    'Teammate';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: (body: string) => sendTeamChat(peerId, body),
    onSuccess: () => {
      setDraft('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['team-chat', peerId] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        width: 340,
        maxWidth: 'calc(100vw - 24px)',
        height: 420,
        background: '#fff',
        border: '0.5px solid var(--line)',
        borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,.18)',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '0.5px solid var(--line)',
          background: 'var(--navy)',
          color: '#fff',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>{peerName}</div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {isLoading && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>}
        {!isLoading && messages.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            Start a quick team chat — only staff can see this.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              justifyContent: m.mine ? 'flex-end' : 'flex-start',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '8px 11px',
                borderRadius: 12,
                fontSize: 13,
                background: m.mine ? 'var(--navy)' : '#f2f4f6',
                color: m.mine ? '#fff' : 'var(--ink)',
              }}
            >
              {m.body}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && (
        <div className="alert-error" style={{ margin: '0 12px 8px', fontSize: 12 }}>
          {error}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 12,
          borderTop: '0.5px solid var(--line)',
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message…"
          style={{
            flex: 1,
            border: '0.5px solid var(--line)',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) send.mutate(draft.trim());
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!draft.trim() || send.isPending}
          onClick={() => draft.trim() && send.mutate(draft.trim())}
        >
          <i className="ti ti-send" />
        </button>
      </div>
    </div>
  );
}
