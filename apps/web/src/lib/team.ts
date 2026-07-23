import { apiFetch } from './api';
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
  status: OrderStatus;
  priceCents: number | null;
  currency: string;
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
  return apiFetch<{ orderId: string; assignedDesignerId: string }>(
    `/admin/team/${userId}/assign/${orderId}`,
    { method: 'POST' },
  );
}

export type TeamChatMessage = {
  id: string;
  fromUserId: string;
  toUserId: string;
  body: string;
  createdAt: string;
  mine: boolean;
};

export function getTeamChat(peerId: string) {
  return apiFetch<{
    peer: TeamMember;
    messages: TeamChatMessage[];
  }>(`/admin/team-chat/${peerId}`);
}

export function sendTeamChat(peerId: string, body: string) {
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
