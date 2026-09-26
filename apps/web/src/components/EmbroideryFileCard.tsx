import { useEffect, useState } from 'react';
import { apiFetch, downloadSignedFile, resolveFileUrl } from '@/lib/api';
import { ImageLightbox } from '@/components/FilePreview';
import { isImageFile } from '@/lib/format';

async function imageBlobUrl(url: string): Promise<string | null> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.size || blob.type.includes('json') || blob.type.startsWith('text/')) return null;
  const typed = blob.type.startsWith('image/')
    ? blob
    : new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' });
  return URL.createObjectURL(typed);
}

function useImageSrc(
  previewUrl: string | null | undefined,
  refreshPath: string | undefined,
  enabled: boolean,
) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || (!previewUrl && !refreshPath)) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let blobUrl: string | null = null;

    async function load() {
      const urls: string[] = [];
      if (previewUrl) urls.push(resolveFileUrl(previewUrl));
      for (const url of urls) {
        const next = await imageBlobUrl(url).catch(() => null);
        if (cancelled) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        if (next) {
          blobUrl = next;
          setSrc(next);
          return;
        }
      }
      if (refreshPath) {
        try {
          const sep = refreshPath.includes('?') ? '&' : '?';
          const fresh = await apiFetch<{ url: string }>(`${refreshPath}${sep}inline=1`);
          if (fresh.url) {
            const next = await imageBlobUrl(resolveFileUrl(fresh.url));
            if (cancelled) {
              if (next) URL.revokeObjectURL(next);
              return;
            }
            if (next) {
              blobUrl = next;
              setSrc(next);
              return;
            }
          }
        } catch {
          /* preview already failed */
        }
      }
      if (!cancelled) setSrc(null);
    }

    void load();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [previewUrl, refreshPath, enabled]);

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
  const src = useImageSrc(previewUrl, signedUrlPath, image);
  const [open, setOpen] = useState(false);
  const swatch = variant === 'swatch';
  const refTag = /reference/i.test(label);

  function downloadLoadedImage() {
    if (!src) return false;
    const a = document.createElement('a');
    a.href = src;
    a.download = name || 'download';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => a.remove(), 0);
    return true;
  }

  async function download() {
    if (downloadLoadedImage()) return;
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
