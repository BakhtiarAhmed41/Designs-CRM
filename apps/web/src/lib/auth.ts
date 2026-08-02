import { apiFetch } from './api';
import type { CurrentUser } from './types';

export function login(email: string, password: string) {
  return apiFetch<{ user: CurrentUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(data: {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
}) {
  return apiFetch<{ user: CurrentUser; pending: boolean }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function forgotPassword(email: string) {
  return apiFetch<{ ok: boolean; resetToken: string | null }>(
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

export function refresh() {
  return apiFetch<{ ok: boolean }>('/auth/refresh', { method: 'POST' });
}

export function logout() {
  return apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
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
