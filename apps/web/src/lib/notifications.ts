import { apiFetch } from "./api";

export type Notification = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications() {
  return apiFetch<{ notifications: Notification[]; unreadCount: number }>("/notifications");
}

export async function markNotificationRead(id: string) {
  return apiFetch<{ ok: true }>(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function markAllNotificationsRead() {
  return apiFetch<{ ok: true }>("/notifications/read-all", { method: "PATCH" });
}

