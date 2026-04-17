export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

function getBase(): string {
  if (!API_BASE) {
    throw new ApiError(
      0,
      "NEXT_PUBLIC_API_BASE_URL is not set. Add it to apps/web/.env.local (e.g. http://localhost:3001/api).",
    );
  }
  return API_BASE.replace(/\/+$/, "");
}

function parseJsonBody(text: string): unknown | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function nestMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const m = (data as { message: unknown }).message;
    if (Array.isArray(m)) return m.map(String).join(", ");
    if (typeof m === "string") return m;
  }
  return fallback;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${getBase()}${path.startsWith("/") ? "" : "/"}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Could not reach the API. Confirm the API is running and NEXT_PUBLIC_API_BASE_URL matches it (include /api if your server uses the /api prefix).",
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = parseJsonBody(text);
  if (!res.ok) {
    const msg = nestMessage(data, text ? text.slice(0, 240) : `Request failed (${res.status})`);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export async function apiFetchForm<T>(path: string, form: FormData, init: RequestInit = {}): Promise<T> {
  const url = `${getBase()}${path.startsWith("/") ? "" : "/"}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      method: init.method ?? "POST",
      body: form,
      credentials: "include",
      headers: {
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Could not reach the API. Confirm the API is running and NEXT_PUBLIC_API_BASE_URL matches it (include /api if your server uses the /api prefix).",
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = parseJsonBody(text);
  if (!res.ok) {
    const msg = nestMessage(data, text ? text.slice(0, 240) : `Request failed (${res.status})`);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

