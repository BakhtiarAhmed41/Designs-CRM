import { apiFetch } from './api';
import type { UserRole } from './types';

export type FeatureKey =
  | 'dashboard'
  | 'messages'
  | 'orders'
  | 'quotes'
  | 'edits'
  | 'customers'
  | 'billing'
  | 'team'
  | 'roles';

export type CustomRole = {
  id: string;
  name: string;
  description: string | null;
  baseRole: 'ADMIN' | 'SUPPORT' | 'DESIGNER';
  permissions: Record<FeatureKey, boolean>;
  createdAt: string;
  updatedAt: string;
};

export type StaffUser = {
  id: string;
  email: string;
  role: UserRole;
  loginStatus: 'PENDING' | 'ACTIVE' | 'DISABLED';
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  customRoleId: string | null;
  customRoleName: string | null;
  presence: string;
  canLogin: boolean;
  createdAt: string;
};

export function listRoles() {
  return apiFetch<{ roles: CustomRole[] }>('/admin/roles');
}

export function listRoleFeatures() {
  return apiFetch<{ features: Array<{ key: FeatureKey; label: string }> }>(
    '/admin/roles/features',
  );
}

export function createRole(data: {
  name: string;
  description?: string | null;
  baseRole: 'ADMIN' | 'SUPPORT' | 'DESIGNER';
  permissions: Partial<Record<FeatureKey, boolean>>;
}) {
  return apiFetch<{ role: CustomRole }>('/admin/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateRole(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    baseRole: 'ADMIN' | 'SUPPORT' | 'DESIGNER';
    permissions: Partial<Record<FeatureKey, boolean>>;
  }>,
) {
  return apiFetch<{ role: CustomRole }>(`/admin/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteRole(id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/roles/${id}`, { method: 'DELETE' });
}

export function listUsers(params?: { q?: string; page?: number; pageSize?: number }) {
  const q = new URLSearchParams();
  if (params?.q) q.set('q', params.q);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const suffix = q.toString() ? `?${q}` : '';
  return apiFetch<{
    users: StaffUser[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>(`/admin/users${suffix}`);
}

export function createUser(data: {
  email: string;
  password: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  role?: UserRole;
  customRoleId?: string | null;
  loginStatus?: 'ACTIVE' | 'DISABLED' | 'PENDING';
}) {
  return apiFetch<{ user: StaffUser }>('/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateUser(
  id: string,
  data: Partial<{
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    role: UserRole;
    customRoleId: string | null;
    loginStatus: 'ACTIVE' | 'DISABLED' | 'PENDING';
    password: string;
  }>,
) {
  return apiFetch<{ user: StaffUser }>(`/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
