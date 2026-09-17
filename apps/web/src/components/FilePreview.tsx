import { useEffect, useMemo, useState } from 'react';
import { apiFetch, downloadSignedFile, resolveFileUrl } from '@/lib/api';
import { isImageFile } from '@/lib/format';
import { myDeliveryFilePreviewUrl } from '@/lib/orders';

function usePreviewSrc(
  previewUrl: string | null | undefined,
  signedUrlPath: string | undefined,
  enabled: boolean,
) {
  const [src, setSrc] = useState<string | null>(() =>
    previewUrl ? resolveFileUrl(previewUrl) : null,
  );
  const [fresh, setFresh] = useState<string | null>(null);
  const [triedFresh, setTriedFresh] = useState(false);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      setFresh(null);
      setTriedFresh(false);
      setDead(false);
      return;
    }
    setTriedFresh(false);
    setDead(false);
    setSrc(previewUrl ? resolveFileUrl(previewUrl) : null);
    if (!signedUrlPath) return;
    let cancelled = false;
    const sep = signedUrlPath.includes('?') ? '&' : '?';
    apiFetch<{ url: string }>(`${signedUrlPath}${sep}inline=1`)
      .then((r) => {
        if (!cancelled && r.url) setFresh(resolveFileUrl(r.url));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [previewUrl, signedUrlPath, enabled]);

  const current = dead ? null : triedFresh ? fresh : src || fresh;
  return {
    src: current,
    onError: () => {
      if (!triedFresh && fresh && current !== fresh) setTriedFresh(true);
      else setDead(true);
    },
  };
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
  onImgError,
}: {
  name: string;
  src?: string | null;
  onOpen?: () => void;
  onImgError?: () => void;
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
        <img
          src={src!}
          alt={name}
          onError={() => {
            setBroken(true);
            onImgError?.();
          }}
        />
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
  const preview = usePreviewSrc(
    previewUrl,
    myDeliveryFilePreviewUrl(orderId, fileId),
    show,
  );
  const src = preview.src;

  if (compact) {
    return src ? (
      <img className="thumb-img" src={src} alt="" onError={preview.onError} />
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
      <FileThumb
        name={name}
        src={src}
        onOpen={src ? () => setOpen(true) : undefined}
        onImgError={preview.onError}
      />
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
  const show = isImageFile(name, mimeType);
  const preview = usePreviewSrc(previewUrl, signedUrlPath, show);
  const src = show ? preview.src : null;

  if (compact) {
    if (show) {
      return (
        <>
          <button
            type="button"
            className="pref-ref-img"
            onClick={() => src && setOpen(true)}
            title={name}
          >
            {src ? <img src={src} alt={name} onError={preview.onError} /> : <i className="ti ti-photo" />}
          </button>
          {open && src && <ImageLightbox src={src} name={name} onClose={() => setOpen(false)} />}
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
      <FileThumb
        name={name}
        src={src}
        onOpen={src ? () => setOpen(true) : undefined}
        onImgError={preview.onError}
      />
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
