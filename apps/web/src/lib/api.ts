export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

function getBase(): string {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
  return API_BASE.replace(/\/+$/, "");
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${getBase()}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as any) : undefined;
  if (!res.ok) {
    const msg = data?.message ? String(data.message) : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

