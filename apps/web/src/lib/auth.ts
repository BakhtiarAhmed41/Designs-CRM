import { apiFetch } from './api';
import { clearSessionTokens, getRefreshTokens, setSessionTokens } from './session';
import type { CurrentUser } from './types';

type AuthTokens = {
  accessToken?: string;
  refreshToken?: string;
  refreshTokenId?: string;
};

export function login(email: string, password: string) {
  return apiFetch<{ user: CurrentUser } & AuthTokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }).then((res) => {
    setSessionTokens(res);
    return res;
  });
}

export function register(data: {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
}) {
  return apiFetch<{
    user: CurrentUser;
    pending: boolean;
    emailSent?: boolean;
    verifyToken?: string | null;
  }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function forgotPassword(email: string) {
  return apiFetch<{ ok: boolean; resetToken: string | null; emailSent?: boolean }>(
    '/auth/forgot-password',
    { method: 'POST', body: JSON.stringify({ email }) },
  );
}

export function resetPassword(token: string, password: string) {
  return apiFetch<{ ok: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export function verifyEmail(token: string) {
  return apiFetch<{ ok: boolean }>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function refresh() {
  const stored = getRefreshTokens();
  return apiFetch<{ ok: boolean } & AuthTokens>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({
      refreshToken: stored?.token,
      refreshTokenId: stored?.id,
    }),
  }).then((res) => {
    if (res.ok || res.accessToken) setSessionTokens(res);
    else clearSessionTokens();
    return res;
  });
}

export function logout() {
  const stored = getRefreshTokens();
  return apiFetch<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({
      refreshToken: stored?.token,
      refreshTokenId: stored?.id,
    }),
  }).finally(() => {
    clearSessionTokens();
  });
}

export function getMe() {
  return apiFetch<{ user: CurrentUser }>('/users/me');
}

export function updateProfile(data: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}) {
  return apiFetch<{ user: CurrentUser }>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function requestEmailChange(email: string) {
  return apiFetch<{ ok: boolean; emailSent: boolean; pendingEmail: string }>(
    '/users/me/email',
    { method: 'POST', body: JSON.stringify({ email }) },
  );
}

export function confirmEmailChange(token: string) {
  return apiFetch<{ ok: boolean }>('/auth/confirm-email-change', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function listLoginRequests() {
  return apiFetch<{
    requests: Array<{
      id: string;
      email: string;
      name: string;
      phone: string | null;
      createdAt: string;
      loginStatus: string;
    }>;
  }>('/admin/login-requests');
}

export function approveLoginRequest(userId: string) {
  return apiFetch<{ ok: boolean }>(`/admin/login-requests/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
}

export function deleteLoginRequest(userId: string) {
  return apiFetch<{ ok: boolean }>(`/admin/login-requests/${userId}`, {
    method: 'DELETE',
  });
}
