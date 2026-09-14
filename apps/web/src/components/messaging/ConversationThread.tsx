import { useEffect, useRef } from 'react';
import { resolveFileUrl } from '@/lib/api';
import { isImageFile } from '@/lib/format';
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
  typing?: boolean;
};

export function ConversationThread({
  messages,
  mineDirection = 'OUTBOUND',
  emptyText = 'No messages yet.',
  typing = false,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  return (
    <div className="msg-thread" ref={bodyRef}>
      {messages.length === 0 && !typing && <div className="msg-empty">{emptyText}</div>}
      {messages.map((m) => {
        const mine = m.direction === mineDirection;
        const deleted = Boolean(m.deletedAt);
        const fromAdmin = m.direction === 'OUTBOUND';
        return (
          <div key={m.id} className={`msg-bubble ${mine ? 'mine' : 'theirs'}`}>
            {!mine && fromAdmin && <div className="msg-sender">Admin</div>}
            <div className="msg-bubble-body">
              {deleted ? <em>Message deleted</em> : m.body}
              {!deleted &&
                (m.attachments ?? []).map((a) => {
                  const href = resolveFileUrl(a.url);
                  const image = isImageFile(a.originalName, a.mimeType);
                  if (image) {
                    return (
                      <a
                        key={a.id}
                        className="msg-file-preview"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img src={href} alt={a.originalName} />
                        <span>{a.originalName}</span>
                      </a>
                    );
                  }
                  return (
                    <a
                      key={a.id}
                      className="msg-file"
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <i className="ti ti-file" /> {a.originalName}
                    </a>
                  );
                })}
            </div>
            <div className="msg-meta">{formatMsgTime(m.createdAt)}</div>
          </div>
        );
      })}
      {typing && (
        <div className="msg-typing" aria-live="polite">
          typing...
        </div>
      )}
    </div>
  );
}
