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
  if (!API_BASE) {
    throw new ApiError(
      0,
      'VITE_API_BASE_URL is not set. Add it to apps/web/.env.local (e.g. http://localhost:3001/api).',
    );
  }
  return API_BASE.replace(/\/+$/, '');
}

/** Absolute origin of the API (used to resolve relative signed file URLs). */
export function apiOrigin(): string {
  try {
    return new URL(getBase()).origin;
  } catch {
    return '';
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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${getBase()}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiFetchForm<T>(
  path: string,
  form: FormData,
  init: RequestInit = {},
): Promise<T> {
  const url = `${getBase()}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    ...init,
    body: form,
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Download a file from a signed-url endpoint response `{ url }`. */
export async function downloadSignedFile(
  signedUrlPath: string,
  filename: string,
): Promise<void> {
  const { url } = await apiFetch<{ url: string }>(signedUrlPath);
  const a = document.createElement('a');
  a.href = resolveFileUrl(url);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
