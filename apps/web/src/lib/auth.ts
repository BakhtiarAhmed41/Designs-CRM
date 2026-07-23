import { apiFetch } from './api';
import type { CurrentUser } from './types';

export function login(email: string, password: string) {
  return apiFetch<{ user: CurrentUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(email: string, password: string) {
  return apiFetch<{ user: CurrentUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

export function refresh() {
  return apiFetch<{ ok: boolean }>('/auth/refresh', { method: 'POST' });
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
