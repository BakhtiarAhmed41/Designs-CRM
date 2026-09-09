import { apiFetch } from './api';
import type { Notification } from './types';

export function listNotifications(params?: { page?: number; pageSize?: number }) {
  const q = new URLSearchParams();
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return apiFetch<{
    notifications: Notification[];
    unreadCount: number;
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  }>(qs ? `/notifications?${qs}` : '/notifications');
}

export function markNotificationRead(id: string) {
  return apiFetch<{ ok: boolean }>(`/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export function markAllNotificationsRead() {
  return apiFetch<{ ok: boolean }>('/notifications/read-all', {
    method: 'PATCH',
  });
}
