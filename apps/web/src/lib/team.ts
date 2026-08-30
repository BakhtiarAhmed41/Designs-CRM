import { apiFetch, apiFetchForm } from './api';
import type { OrderStatus, UserRole } from './types';

export type Presence = 'ON' | 'AWAY' | 'OFF';

export type TeamMember = {
  id: string;
  email: string;
  role: UserRole;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  initials: string | null;
  presence: Presence;
  skills: string[];
  permissions: Record<string, boolean>;
  workload: number;
  createdAt: string;
  updatedAt: string;
};

export type MyWorkOrder = {
  id: string;
  humanRef: string | null;
  name: string | null;
  serviceType?: string | null;
  status: OrderStatus;
  dueDate: string | null;
  createdAt: string;
  customerName: string | null;
};

export type CreateTeamMemberInput = {
  email: string;
  password: string;
  role: UserRole;
  firstName?: string | null;
  skills?: string[];
};

export type UpdateTeamMemberInput = {
  role?: UserRole;
  firstName?: string | null;
  lastName?: string | null;
  skills?: string[];
  permissions?: Record<string, boolean>;
  presence?: Presence;
  password?: string;
};

export function listTeam() {
  return apiFetch<{ members: TeamMember[] }>('/admin/team');
}

export function createTeamMember(data: CreateTeamMemberInput) {
  return apiFetch<{ member: TeamMember }>('/admin/team', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateTeamMember(id: string, data: UpdateTeamMemberInput) {
  return apiFetch<{ member: TeamMember }>(`/admin/team/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function setMyPresence(presence: Presence) {
  return apiFetch<{ member: TeamMember }>('/me/presence', {
    method: 'PATCH',
    body: JSON.stringify({ presence }),
  });
}

export function listMyWork() {
  return apiFetch<{ orders: MyWorkOrder[] }>('/admin/mywork');
}

export function assignOrder(userId: string, orderId: string) {
  return apiFetch<{ orderId: string; assignedDesignerId: string | null }>(
    `/admin/team/${userId}/assign/${orderId}`,
    { method: 'POST' },
  );
}

export function unassignOrder(orderId: string) {
  return apiFetch<{ orderId: string; assignedDesignerId: null }>(
    `/admin/team/unassign/${orderId}`,
    { method: 'POST' },
  );
}

export type TeamChatAttachment = {
  id: string;
  originalName: string;
  mimeType: string | null;
  byteSize: number | null;
  url: string;
};

export type TeamChatMessage = {
  id: string;
  fromUserId: string;
  toUserId: string;
  body: string;
  readAt?: string | null;
  createdAt: string;
  mine: boolean;
  attachments?: TeamChatAttachment[];
};

function buildChatForm(body: string, files?: File[]) {
  const form = new FormData();
  form.append('body', body);
  for (const f of files ?? []) form.append('files', f);
  return form;
}

export function getTeamChat(peerId: string) {
  return apiFetch<{
    peer: TeamMember;
    messages: TeamChatMessage[];
  }>(`/admin/team-chat/${peerId}`);
}

export function sendTeamChat(peerId: string, body: string, files?: File[]) {
  if (files?.length) {
    return apiFetchForm<{
      peer: TeamMember;
      messages: TeamChatMessage[];
    }>(`/admin/team-chat/${peerId}`, buildChatForm(body, files));
  }
  return apiFetch<{
    peer: TeamMember;
    messages: TeamChatMessage[];
  }>(`/admin/team-chat/${peerId}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function getTeamChatOwner() {
  return apiFetch<{ peerId: string | null }>('/admin/team-chat-owner');
}

export function getTeamUnreadSummary() {
  return apiFetch<{
    dmUnread: number;
    groupUnread: number;
    peerUnread: Record<string, number>;
  }>('/admin/team-chat/unread-summary');
}

export function getRecentTeamChats() {
  return apiFetch<{
    conversations: Array<{
      peerId: string;
      lastAt: string;
      lastBody: string;
      unread: number;
    }>;
  }>('/admin/team-chat/recent');
}

export type GroupChatMessage = {
  id: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  senderName: string;
  attachments?: TeamChatAttachment[];
};

export function listGroupChat() {
  return apiFetch<{ messages: GroupChatMessage[] }>('/admin/team-group-chat');
}

export function sendGroupChat(body: string, files?: File[]) {
  if (files?.length) {
    return apiFetchForm<{ messages: GroupChatMessage[] }>(
      '/admin/team-group-chat',
      buildChatForm(body, files),
    );
  }
  return apiFetch<{ messages: GroupChatMessage[] }>('/admin/team-group-chat', {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}
