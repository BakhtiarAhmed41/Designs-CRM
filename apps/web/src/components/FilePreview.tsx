import { useEffect, useMemo, useState } from 'react';
import { apiFetch, downloadSignedFile, resolveFileUrl } from '@/lib/api';
import { isImageFile } from '@/lib/format';
import { myDeliveryFilePreviewUrl } from '@/lib/orders';

async function asDisplayUrl(url: string, safe: boolean) {
  if (!safe) return url;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.size || blob.type.includes('json') || blob.type.startsWith('text/')) return null;
  const typed = blob.type.startsWith('image/')
    ? blob
    : new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' });
  return URL.createObjectURL(typed);
}

function usePreviewSrc(
  previewUrl: string | null | undefined,
  signedUrlPath: string | undefined,
  enabled: boolean,
  safe = false,
) {
  const [src, setSrc] = useState<string | null>(() =>
    !safe && previewUrl ? resolveFileUrl(previewUrl) : null,
  );
  const [fresh, setFresh] = useState<string | null>(null);
  const [triedFresh, setTriedFresh] = useState(false);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let blobUrl: string | null = null;
    let cancelled = false;

    async function load() {
      if (!enabled) {
        setSrc(null);
        setFresh(null);
        setTriedFresh(false);
        setDead(false);
        return;
      }
      setTriedFresh(false);
      setDead(false);

      const urls: string[] = [];
      if (previewUrl) urls.push(resolveFileUrl(previewUrl));
      if (signedUrlPath) {
        try {
          const sep = signedUrlPath.includes('?') ? '&' : '?';
          const r = await apiFetch<{ url: string }>(`${signedUrlPath}${sep}inline=1`);
          if (r.url) urls.push(resolveFileUrl(r.url));
        } catch {
          /* keep going */
        }
      }

      if (safe) {
        for (const url of urls) {
          try {
            const next = await asDisplayUrl(url, true);
            if (cancelled) {
              if (next) URL.revokeObjectURL(next);
              return;
            }
            if (next) {
              blobUrl = next;
              setSrc(next);
              return;
            }
          } catch {
            /* try next */
          }
        }
        if (!cancelled) setSrc(null);
        return;
      }

      setSrc(urls[0] ?? null);
      if (urls[1]) setFresh(urls[1]);
    }

    void load();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [previewUrl, signedUrlPath, enabled, safe]);

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
      <img
        src={src}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        onError={() => {
          // #region agent log
          fetch('http://127.0.0.1:7422/ingest/0d72200c-b460-4f6d-9776-9f9a8178c9c9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bd9c4e'},body:JSON.stringify({sessionId:'bd9c4e',hypothesisId:'C',location:'FilePreview.tsx:ImageLightbox',message:'preview image failed to render',data:{srcPath:(()=>{try{return new URL(src).pathname}catch{return 'relative'}})(),sameHost:(()=>{try{return new URL(src,window.location.href).host===window.location.host}catch{return false}})()},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          onClose();
        }}
      />
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
  safe,
}: {
  orderId: string;
  fileId: string;
  name: string;
  mimeType?: string | null;
  previewUrl?: string | null;
  compact?: boolean;
  safe?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const show = isImageFile(name, mimeType);
  const preview = usePreviewSrc(
    previewUrl,
    myDeliveryFilePreviewUrl(orderId, fileId),
    show,
    safe,
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
  safe,
}: {
  name: string;
  mimeType?: string | null;
  signedUrlPath: string;
  previewUrl?: string | null;
  compact?: boolean;
  safe?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const show = isImageFile(name, mimeType);
  const preview = usePreviewSrc(previewUrl, signedUrlPath, show, safe);
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
