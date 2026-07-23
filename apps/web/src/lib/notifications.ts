import { apiFetch } from './api';
import type { Notification } from './types';

export function listNotifications() {
  return apiFetch<{ notifications: Notification[]; unreadCount: number }>(
    '/notifications',
  );
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
