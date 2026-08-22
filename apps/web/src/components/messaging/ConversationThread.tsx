import { useEffect, useRef } from 'react';
import { resolveFileUrl } from '@/lib/api';
import type { Message } from '@/lib/messaging';

function formatMsgTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type Props = {
  messages: Message[];
  mineDirection?: 'INBOUND' | 'OUTBOUND';
  emptyText?: string;
  onDelete?: (id: string) => void;
};

export function ConversationThread({
  messages,
  mineDirection = 'OUTBOUND',
  emptyText = 'No messages yet.',
  onDelete,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="msg-thread" ref={bodyRef}>
      {messages.length === 0 && <div className="msg-empty">{emptyText}</div>}
      {messages.map((m) => {
        const mine = m.direction === mineDirection;
        const deleted = Boolean(m.deletedAt);
        return (
          <div key={m.id} className={`msg-bubble ${mine ? 'mine' : 'theirs'}`}>
            <div className="msg-bubble-body">
              {deleted ? <em>Message deleted</em> : m.body}
              {!deleted &&
                (m.attachments ?? []).map((a) => (
                  <a
                    key={a.id}
                    className="msg-file"
                    href={resolveFileUrl(a.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <i className="ti ti-file" /> {a.originalName}
                  </a>
                ))}
            </div>
            <div className="msg-meta">
              {formatMsgTime(m.createdAt)}
              {onDelete && mine && !deleted && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 8, fontSize: 11 }}
                  onClick={() => onDelete(m.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
