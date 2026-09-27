import {
  authorizationHeader,
  getRefreshTokens,
  setSessionTokens,
} from './session';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

function getBase(): string {
  const raw = (API_BASE && String(API_BASE).trim()) || '/api';
  return raw.replace(/\/+$/, '');
}

function pageOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

/** Absolute origin of the API (used to resolve relative signed file URLs). */
export function apiOrigin(): string {
  try {
    return new URL(getBase(), pageOrigin()).origin;
  } catch {
    return pageOrigin();
  }
}

/** Resolve a possibly-relative URL (e.g. /api/files/download?...) to absolute. */
export function resolveFileUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiOrigin()}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Safely extract a human message from any thrown value. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return err.message && err.message !== 'Unauthorized'
        ? err.message
        : 'Session expired or not authorized. Please log in again.';
    }
    if (err.status === 403) {
      return err.message && err.message !== 'Forbidden'
        ? err.message
        : 'You don’t have permission for this action.';
    }
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong';
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const msg = data?.message ?? data?.error;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
  } catch {
    /* ignore */
  }
  return res.statusText || `Request failed (${res.status})`;
}

function isAuthPath(path: string): boolean {
  return /^\/?auth\//.test(path);
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const stored = getRefreshTokens();
      const res = await fetch(`${getBase()}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refreshToken: stored?.token,
          refreshTokenId: stored?.id,
        }),
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        accessToken?: string;
        refreshToken?: string;
        refreshTokenId?: string;
      } | null;
      if (data?.accessToken) setSessionTokens(data);
      return Boolean(data?.ok || data?.accessToken);
    } catch {
      return false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function apiUrl(path: string): string {
  return `${getBase()}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function parseOk<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function withRefreshRetry(path: string, run: () => Promise<Response>): Promise<Response> {
  const first = await run();
  if (first.status !== 401 || isAuthPath(path)) return first;
  const refreshed = await refreshSession();
  if (!refreshed) return first;
  return run();
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await withRefreshRetry(path, () =>
    fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...authorizationHeader(),
        ...(init.headers ?? {}),
      },
    }),
  );
  return parseOk<T>(res);
}

export async function apiFetchForm<T>(
  path: string,
  form: FormData,
  init: RequestInit = {},
): Promise<T> {
  const res = await withRefreshRetry(path, () =>
    fetch(apiUrl(path), {
      method: 'POST',
      ...init,
      body: form,
      credentials: 'include',
      headers: {
        ...authorizationHeader(),
        ...(init.headers ?? {}),
      },
    }),
  );
  return parseOk<T>(res);
}

export async function downloadFileFromUrl(url: string, filename: string) {
  if (url.startsWith('blob:')) {
    triggerBrowserDownload(url, filename, false);
    return;
  }
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('unavailable');
    const blob = await res.blob();
    if (!blob.size || blob.type.includes('json') || blob.type.startsWith('text/')) {
      throw new Error('unavailable');
    }
    triggerBrowserDownload(URL.createObjectURL(blob), filename, true);
  } catch {
    triggerBrowserDownload(url, filename, false);
  }
}

function triggerBrowserDownload(href: string, filename: string, revoke: boolean) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename || 'download';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Revoking or removing the link in the same turn cancels the download.
  window.setTimeout(() => {
    a.remove();
    if (revoke) URL.revokeObjectURL(href);
  }, 2000);
}

/** Download a file from a signed-url endpoint response `{ url }`. */
export async function downloadSignedFile(
  signedUrlPath: string,
  filename: string,
  opts?: { stayOnPage?: boolean },
): Promise<void> {
  const { url } = await apiFetch<{ url: string }>(signedUrlPath);
  const abs = resolveFileUrl(url);
  if (opts?.stayOnPage) {
    const res = await fetch(abs, { credentials: 'include' });
    if (!res.ok) {
      throw new ApiError(res.status, 'This file is no longer available.');
    }
    const blob = await res.blob();
    if (!blob.size || blob.type.includes('json') || blob.type.startsWith('text/')) {
      throw new ApiError(404, 'This file is no longer available.');
    }
    const typed =
      blob.type && blob.type !== 'application/octet-stream'
        ? blob
        : new Blob([await blob.arrayBuffer()], {
            type: guessDownloadType(filename) || blob.type || 'application/octet-stream',
          });
    triggerBrowserDownload(URL.createObjectURL(typed), filename, true);
    return;
  }
  triggerBrowserDownload(abs, filename, false);
}

function guessDownloadType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return '';
}
