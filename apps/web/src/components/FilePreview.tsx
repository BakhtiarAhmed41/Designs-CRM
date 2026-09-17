import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, downloadSignedFile, resolveFileUrl } from '@/lib/api';
import { isImageFile } from '@/lib/format';
import { myDeliveryFilePreviewUrl } from '@/lib/orders';

export function ImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <div className="file-lightbox" onClick={onClose} role="dialog" aria-label={name}>
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="file-lightbox-x" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

export function FileThumb({
  name,
  src,
  onOpen,
}: {
  name: string;
  src?: string | null;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className={`file-thumb${src ? '' : ' is-fallback'}`}
      onClick={onOpen}
      disabled={!onOpen}
    >
      {src ? (
        <img src={src} alt={name} />
      ) : (
        <div className="file-thumb-icon" aria-hidden>
          <i className="ti ti-photo" />
        </div>
      )}
      <span title={name}>{name}</span>
    </button>
  );
}

export function DeliveryPreview({
  orderId,
  fileId,
  name,
  mimeType,
  previewUrl,
  compact,
}: {
  orderId: string;
  fileId: string;
  name: string;
  mimeType?: string | null;
  previewUrl?: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const show = isImageFile(name, mimeType);
  const q = useQuery({
    queryKey: ['delivery-preview', orderId, fileId],
    queryFn: async () => {
      const { url } = await apiFetch<{ url: string }>(
        myDeliveryFilePreviewUrl(orderId, fileId),
      );
      return url;
    },
    enabled: show && !previewUrl,
    staleTime: 60_000,
  });
  const src = previewUrl || q.data ? resolveFileUrl(previewUrl || q.data || '') : null;

  if (compact) {
    return src ? <img className="thumb-img" src={src} alt="" /> : <i className="ti ti-photo" aria-hidden />;
  }

  if (!show && !src) {
    return (
      <div className="file-thumb is-fallback">
        <div className="file-thumb-icon">
          <i className="ti ti-file" />
        </div>
        <span title={name}>{name}</span>
      </div>
    );
  }

  return (
    <>
      <FileThumb name={name} src={src} onOpen={src ? () => setOpen(true) : undefined} />
      {open && src && <ImageLightbox src={src} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AttachmentPreview({
  name,
  mimeType,
  signedUrlPath,
  previewUrl,
}: {
  name: string;
  mimeType?: string | null;
  signedUrlPath: string;
  previewUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const show = isImageFile(name, mimeType);
  const q = useQuery({
    queryKey: ['attachment-preview', signedUrlPath],
    queryFn: async () => {
      const { url } = await apiFetch<{ url: string }>(`${signedUrlPath}?inline=1`);
      return url;
    },
    enabled: show && !previewUrl,
    staleTime: 60_000,
  });
  const src = previewUrl || q.data ? resolveFileUrl(previewUrl || q.data || '') : null;

  if (!show && !src) {
    return (
      <FileThumb
        name={name}
        onOpen={() => {
          void downloadSignedFile(signedUrlPath, name);
        }}
      />
    );
  }

  return (
    <>
      <FileThumb name={name} src={src} onOpen={src ? () => setOpen(true) : undefined} />
      {open && src && <ImageLightbox src={src} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

export function LocalFilePreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const src = useMemo(
    () => (isImageFile(file.name, file.type) ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src);
  }, [src]);

  return (
    <div className="file-thumb-local">
      <FileThumb name={file.name} src={src} onOpen={src ? () => setOpen(true) : undefined} />
      {onRemove && (
        <button type="button" className="file-thumb-x" onClick={onRemove} aria-label={`Remove ${file.name}`}>
          ×
        </button>
      )}
      {open && src && <ImageLightbox src={src} name={file.name} onClose={() => setOpen(false)} />}
    </div>
  );
}
