import { useEffect, useMemo, useState } from 'react';
import { apiFetch, downloadSignedFile, resolveFileUrl } from '@/lib/api';
import { isImageFile } from '@/lib/format';

function usePreviewSrc(
  previewUrl: string | null | undefined,
  signedUrlPath: string | undefined,
  enabled: boolean,
) {
  const [src, setSrc] = useState<string | null>(() =>
    previewUrl ? resolveFileUrl(previewUrl) : null,
  );

  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return;
    }
    if (previewUrl) {
      setSrc(resolveFileUrl(previewUrl));
      return;
    }
    if (!signedUrlPath) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    const sep = signedUrlPath.includes('?') ? '&' : '?';
    apiFetch<{ url: string }>(`${signedUrlPath}${sep}inline=1`)
      .then((r) => {
        if (!cancelled && r.url) setSrc(resolveFileUrl(r.url));
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [previewUrl, signedUrlPath, enabled]);

  return src;
}

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
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  const showImg = Boolean(src) && !broken;

  return (
    <button
      type="button"
      className={`file-thumb${showImg ? '' : ' is-fallback'}`}
      onClick={onOpen}
      disabled={!onOpen}
    >
      {showImg ? (
        <img src={src!} alt={name} onError={() => setBroken(true)} />
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
  const src = usePreviewSrc(previewUrl, undefined, show);

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
  compact,
}: {
  name: string;
  mimeType?: string | null;
  signedUrlPath: string;
  previewUrl?: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const show = isImageFile(name, mimeType);
  const loaded = usePreviewSrc(previewUrl, signedUrlPath, show);
  const src = show && !broken ? loaded : null;

  if (compact) {
    if (src) {
      return (
        <>
          <button type="button" className="pref-ref-img" onClick={() => setOpen(true)} title={name}>
            <img src={src} alt={name} onError={() => setBroken(true)} />
          </button>
          {open && <ImageLightbox src={src} name={name} onClose={() => setOpen(false)} />}
        </>
      );
    }
    return (
      <span className="pref-file" title={name}>
        {name}
      </span>
    );
  }

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
