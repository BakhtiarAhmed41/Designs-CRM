import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { getErrorMessage, resolveFileUrl } from '@/lib/api';
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
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['team-chat', peerId],
    queryFn: () => getTeamChat(peerId),
    refetchInterval: 30_000,
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
    mutationFn: ({ body, files }: { body: string; files: File[] }) =>
      sendTeamChat(peerId, body, files),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['team-chat', peerId] });
      qc.invalidateQueries({ queryKey: ['team-unread'] });
      qc.invalidateQueries({ queryKey: ['team-recent'] });
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
        height: 460,
        background: 'var(--etsy-white)',
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
            Start a quick team chat. Only staff can see this.
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
              {(m.attachments?.length ?? 0) > 0 && (
                <div style={{ marginTop: 6 }}>
                  {m.attachments!.map((a) => (
                    <a
                      key={a.id}
                      href={resolveFileUrl(a.url)}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'block',
                        fontSize: 11.5,
                        color: m.mine ? '#cfe0ff' : 'var(--navy)',
                      }}
                    >
                      📎 {a.originalName}
                    </a>
                  ))}
                </div>
              )}
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
      <MessageComposer
        placeholder="Message…"
        onSend={async (body, files) => {
          await send.mutateAsync({ body, files });
        }}
      />
    </div>
  );
}
