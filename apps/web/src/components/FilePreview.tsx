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

async function signedImageSrc(path: string): Promise<string> {
  const { url } = await apiFetch<{ url: string }>(path);
  const abs = resolveFileUrl(url);
  const res = await fetch(abs, { credentials: 'include' });
  if (!res.ok) throw new Error('Could not open file');
  const blob = await res.blob();
  if (!blob.size) throw new Error('Empty file');
  return URL.createObjectURL(blob);
}

function useSignedImage(path: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['signed-image', path],
    queryFn: () => signedImageSrc(path!),
    enabled: Boolean(enabled && path),
    staleTime: 60_000,
    retry: 1,
  });
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
  const q = useSignedImage(show ? myDeliveryFilePreviewUrl(orderId, fileId) : null, show && !previewUrl);
  const src = previewUrl ? resolveFileUrl(previewUrl) : q.data;

  if (compact) {
    return src ? (
      <img className="thumb-img" src={src} alt="" />
    ) : (
      <i className="ti ti-photo" aria-hidden />
    );
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
  const q = useSignedImage(show ? signedUrlPath : null, show);

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
      <FileThumb name={name} src={q.data} onOpen={q.data ? () => setOpen(true) : undefined} />
      {open && q.data && <ImageLightbox src={q.data} name={name} onClose={() => setOpen(false)} />}
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
