import type { QueryClient } from '@tanstack/react-query';
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

type NotificationListCache = {
  notifications?: Notification[];
  unreadCount?: number;
};

/** Hide unread on message alerts as soon as that chat is opened. */
export function markConversationNotificationsInCache(
  qc: QueryClient,
  conversationId: string,
) {
  const now = new Date().toISOString();
  for (const queryKey of [['notifications'], ['my-activity']] as const) {
    qc.setQueriesData({ queryKey: [...queryKey] }, (prev: unknown) => {
      if (!prev || typeof prev !== 'object') return prev;
      const data = prev as NotificationListCache;
      if (!Array.isArray(data.notifications)) return prev;
      const notifications = data.notifications.map((n) =>
        n.link?.includes(conversationId) && !n.readAt ? { ...n, readAt: now } : n,
      );
      return {
        ...data,
        notifications,
        unreadCount: notifications.filter((n) => !n.readAt).length,
      };
    });
  }
}
