export type SessionTokens = {
  accessToken?: string | null;
  refreshToken?: string | null;
  refreshTokenId?: string | null;
};

const ACCESS_KEY = 'lvd.access_token';
const REFRESH_KEY = 'lvd.refresh_token';
const REFRESH_ID_KEY = 'lvd.refresh_token_id';

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return store()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshTokens(): { token: string; id: string } | null {
  const s = store();
  const token = s?.getItem(REFRESH_KEY);
  const id = s?.getItem(REFRESH_ID_KEY);
  if (!token || !id) return null;
  return { token, id };
}

export function setSessionTokens(tokens: SessionTokens) {
  const s = store();
  if (!s) return;
  if (tokens.accessToken) s.setItem(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) s.setItem(REFRESH_KEY, tokens.refreshToken);
  if (tokens.refreshTokenId) s.setItem(REFRESH_ID_KEY, tokens.refreshTokenId);
}

export function clearSessionTokens() {
  const s = store();
  s?.removeItem(ACCESS_KEY);
  s?.removeItem(REFRESH_KEY);
  s?.removeItem(REFRESH_ID_KEY);
}

export function authorizationHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
