import { resolveFileUrl } from '@/lib/api';
import type { MessageAttachment } from '@/lib/messaging';

export function MessageAttachments({
  attachments,
}: {
  attachments?: MessageAttachment[] | null;
}) {
  if (!attachments?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {attachments.map((a) => (
        <a
          key={a.id}
          href={resolveFileUrl(a.url)}
          target="_blank"
          rel="noreferrer"
          download={a.originalName}
          className="odf"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <i className="ti ti-paperclip" /> {a.originalName}
        </a>
      ))}
    </div>
  );
}
