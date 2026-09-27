import { useState } from 'react';
import { ImageLightbox } from '@/components/FilePreview';
import { resolveFileUrl } from '@/lib/api';
import { isImageFile } from '@/lib/format';
import type { MessageAttachment } from '@/lib/messaging';

export function MessageAttachments({
  attachments,
}: {
  attachments?: MessageAttachment[] | null;
}) {
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  if (!attachments?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {attachments.map((a) => {
        const href = resolveFileUrl(a.url);
        const image = isImageFile(a.originalName, a.mimeType);
        if (image) {
          return (
            <button
              key={a.id}
              type="button"
              className="msg-file-preview"
              onClick={() => setPreview({ src: href, name: a.originalName })}
            >
              <img src={href} alt={a.originalName} />
              <span>{a.originalName}</span>
            </button>
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
      {preview && (
        <ImageLightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
