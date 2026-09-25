import { useEffect, useState } from 'react';
import { downloadSignedFile, resolveFileUrl } from '@/lib/api';
import { ImageLightbox } from '@/components/FilePreview';
import { isImageFile } from '@/lib/format';

function useImageSrc(previewUrl: string | null | undefined, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !previewUrl) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let blobUrl: string | null = null;
    void fetch(resolveFileUrl(previewUrl), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!blob.size || blob.type.includes('json') || blob.type.startsWith('text/')) return null;
        const typed = blob.type.startsWith('image/')
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' });
        blobUrl = URL.createObjectURL(typed);
        return blobUrl;
      })
      .then((url) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [previewUrl, enabled]);

  return src;
}

export function EmbroideryFileCard({
  name,
  mimeType,
  previewUrl,
  signedUrlPath,
  label,
  variant = 'row',
  onError,
}: {
  name: string;
  mimeType?: string | null;
  previewUrl?: string | null;
  signedUrlPath: string;
  label: string;
  variant?: 'row' | 'swatch';
  onError?: (message: string) => void;
}) {
  const image = isImageFile(name, mimeType);
  const src = useImageSrc(previewUrl, image);
  const [open, setOpen] = useState(false);
  const swatch = variant === 'swatch';
  const refTag = /reference/i.test(label);

  async function download() {
    try {
      await downloadSignedFile(signedUrlPath, name, { stayOnPage: true });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not download this file.');
    }
  }

  return (
    <div className={swatch ? 'eqf-swatch' : 'eqf-card'}>
      <div className={swatch ? 'eqf-swatch-thumb' : 'eqf-thumb'}>
        {src ? <img src={src} alt="" /> : <span>{image ? 'IMG' : 'FILE'}</span>}
      </div>
      {swatch ? (
        <>
          <div className="eqf-swatch-name" title={name}>{name}</div>
          <span className={refTag ? 'eqf-swatch-tag ref' : 'eqf-swatch-tag'}>{label}</span>
        </>
      ) : (
        <div className="eqf-body">
          <div className="eqf-top">
            <b title={name}>{name}</b>
            <span className={refTag ? 'eqf-lbl ref' : 'eqf-lbl'}>{label}</span>
          </div>
        </div>
      )}
      <div className={swatch ? 'eqf-swatch-acts' : 'eqf-acts'}>
        <button
          type="button"
          title="Preview"
          aria-label={`Preview ${name}`}
          onClick={() => {
            if (src) setOpen(true);
            else void download();
          }}
        >
          <i className="ti ti-eye" />
        </button>
        <button type="button" title="Download" aria-label={`Download ${name}`} onClick={() => void download()}>
          <i className="ti ti-download" />
        </button>
      </div>
      {open && src && <ImageLightbox src={src} name={name} onClose={() => setOpen(false)} />}
    </div>
  );
}
