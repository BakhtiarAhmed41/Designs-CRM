import { resolveFileUrl } from '@/lib/api';
import { isImageFile } from '@/lib/format';
import type { MessageAttachment } from '@/lib/messaging';

export function MessageAttachments({
  attachments,
}: {
  attachments?: MessageAttachment[] | null;
}) {
  if (!attachments?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {attachments.map((a) => {
        const href = resolveFileUrl(a.url);
        const image = isImageFile(a.originalName, a.mimeType);
        if (image) {
          return (
            <a
              key={a.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="msg-file-preview"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <img src={href} alt={a.originalName} />
              <span>{a.originalName}</span>
            </a>
          );
        }
        return (
          <a
            key={a.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            download={a.originalName}
            className="odf"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <i className="ti ti-paperclip" /> {a.originalName}
          </a>
        );
      })}
    </div>
  );
}
