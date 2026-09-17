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
      className="file-thumb"
      onClick={onOpen}
      disabled={!onOpen}
    >
      {src ? (
        <img src={src} alt={name} />
      ) : (
        <div className="file-thumb-icon">
          <i className="ti ti-file" />
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
}: {
  orderId: string;
  fileId: string;
  name: string;
  mimeType?: string | null;
  previewUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const show = isImageFile(name, mimeType);
  const q = useQuery({
    queryKey: ['delivery-preview', orderId, fileId],
    queryFn: async () => {
      const { url } = await apiFetch<{ url: string }>(
        myDeliveryFilePreviewUrl(orderId, fileId),
      );
      return resolveFileUrl(url);
    },
    enabled: show && !previewUrl,
    staleTime: 60_000,
  });
  const src = previewUrl ? resolveFileUrl(previewUrl) : q.data;
  if (!show && !src) {
    return (
      <div className="file-thumb">
        <div className="file-thumb-icon">
          <i className="ti ti-photo" />
        </div>
        <span title={name}>{name}</span>
      </div>
    );
  }
  return (
    <>
      <FileThumb name={name} src={src} onOpen={src ? () => setOpen(true) : undefined} />
      {open && src && (
        <ImageLightbox src={src} name={name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export function AttachmentPreview({
  name,
  mimeType,
  signedUrlPath,
}: {
  name: string;
  mimeType?: string | null;
  signedUrlPath: string;
}) {
  const [open, setOpen] = useState(false);
  const show = isImageFile(name, mimeType);
  const q = useQuery({
    queryKey: ['attachment-preview', signedUrlPath],
    queryFn: async () => {
      const { url } = await apiFetch<{ url: string }>(signedUrlPath);
      return resolveFileUrl(url);
    },
    enabled: show,
    staleTime: 60_000,
  });
  const src = q.data;

  if (!show) {
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
