import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/lib/api';
import {
  createRole,
  createUser,
  deleteRole,
  listRoleFeatures,
  listRoles,
  listUsers,
  updateRole,
  updateUser,
  type CustomRole,
  type FeatureKey,
  type StaffUser,
} from '@/lib/roles';
import type { UserRole } from '@/lib/types';
import { defaultFeaturesForRole } from '@/lib/permissions';

type Tab = 'roles' | 'users';
type BaseRole = 'ADMIN' | 'SUPPORT' | 'DESIGNER';
type SystemStaffRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'DESIGNER';

const EMPTY_PERMS: Record<FeatureKey, boolean> = {
  dashboard: true,
  messages: true,
  messages_customer_view: true,
  messages_customer_reply: true,
  messages_customer_start: true,
  messages_team_view: true,
  messages_team_send: true,
  messages_group: true,
  messages_delete: false,
  orders: true,
  quotes: true,
  edits: true,
  customers: true,
  billing: false,
  team: false,
  roles: false,
};

const MESSAGING_KEYS: FeatureKey[] = [
  'messages',
  'messages_customer_view',
  'messages_customer_reply',
  'messages_customer_start',
  'messages_team_view',
  'messages_team_send',
  'messages_group',
  'messages_delete',
];

type FeatureItem = { key: FeatureKey; label: string };

function FeatureCheckboxGrid({
  items,
  permissions,
  onToggle,
}: {
  items: FeatureItem[];
  permissions: Record<FeatureKey, boolean>;
  onToggle: (key: FeatureKey, checked: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '6px 12px',
        marginBottom: 8,
      }}
    >
      {items.map((f) => (
        <label
          key={f.key}
          style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={!!permissions[f.key]}
            onChange={(e) => onToggle(f.key, e.target.checked)}
          />
          {f.label}
        </label>
      ))}
    </div>
  );
}

function systemRoleLabel(role: UserRole | SystemStaffRole): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Admin';
    case 'ADMIN':
      return 'Admin';
    case 'SUPPORT':
      return 'Support';
    case 'DESIGNER':
      return 'Designer';
    default:
      return role;
  }
}

const BASE_ROLES: Array<{
  role: SystemStaffRole;
  description: string;
}> = [
  { role: 'SUPER_ADMIN', description: 'Full access. Built-in and cannot be changed.' },
  { role: 'ADMIN', description: 'Full studio access. Built-in and cannot be changed.' },
  { role: 'SUPPORT', description: 'Orders, quotes, customers, and messaging.' },
  { role: 'DESIGNER', description: 'Orders, edits, and messaging.' },
];

function enabledPermissionKeys(permissions: Record<string, boolean>) {
  return Object.entries(permissions)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ') || 'None';
}

function loginLabel(status: StaffUser['loginStatus']): string {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'DISABLED') return 'Disabled';
  return 'Pending';
}

export function AdminRolesUsers() {
  const { user } = useAuth();
  const canManage = Boolean(user?.permissions?.features?.roles);
  const [tab, setTab] = useState<Tab>('roles');

  if (!canManage) {
    return (
      <div>
        <div className="ph">
          <div>
            <h1>Roles &amp; users</h1>
            <div className="sub">You do not have permission to manage roles and users.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Roles &amp; users</h1>
          <div className="sub">
            Roles, staff users, and grouped permissions. View, create, and manage admin access.
          </div>
        </div>
      </div>
      <div className="filters">
        <button type="button" className={tab === 'roles' ? 'on' : ''} onClick={() => setTab('roles')}>
          Roles
        </button>
        <button type="button" className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>
          Users
        </button>
      </div>
      {tab === 'roles' ? <RolesPanel /> : <UsersPanel />}
    </div>
  );
}

function RolesPanel() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<'create' | CustomRole | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin-roles'], queryFn: listRoles });
  const roles = data?.roles ?? [];

  const del = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-roles'] }),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
        <button type="button" className="btn btn-primary" onClick={() => setModal('create')}>
          <i className="ti ti-plus" /> Add role
        </button>
      </div>
      <div className="card">
        {isLoading && <div style={{ padding: 16 }}>Loading…</div>}
        {!isLoading && (
          <table className="qtable">
            <thead>
              <tr>
                <th>Role</th>
                <th>Base access</th>
                <th>Permissions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {BASE_ROLES.map((b) => (
                <tr key={b.role}>
                  <td>
                    <b>{systemRoleLabel(b.role)}</b>
                    <span className="chip" style={{ marginLeft: 8, fontSize: 11 }}>
                      Built-in
                    </span>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.description}</div>
                  </td>
                  <td>{systemRoleLabel(b.role)}</td>
                  <td style={{ fontSize: 12 }}>
                    {enabledPermissionKeys(defaultFeaturesForRole(b.role))}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--faint)' }}>View only</td>
                </tr>
              ))}
              {roles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    {r.description && (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.description}</div>
                    )}
                  </td>
                  <td>{systemRoleLabel(r.baseRole)}</td>
                  <td style={{ fontSize: 12 }}>{enabledPermissionKeys(r.permissions)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setModal(r)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={del.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete role “${r.name}”? Users with this role keep their system role but lose custom permissions.`,
                          )
                        ) {
                          del.mutate(r.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {modal && (
        <RoleFormModal
          role={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function RoleFormModal({
  role,
  onClose,
}: {
  role: CustomRole | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = Boolean(role);
  const featuresQ = useQuery({ queryKey: ['role-features'], queryFn: listRoleFeatures });
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [baseRole, setBaseRole] = useState<BaseRole>(role?.baseRole ?? 'SUPPORT');
  const [permissions, setPermissions] = useState<Record<FeatureKey, boolean>>(
    () => ({ ...EMPTY_PERMS, ...(role?.permissions ?? {}) }),
  );
  const [error, setError] = useState<string | null>(null);

  const features =
    featuresQ.data?.features ??
    Object.keys(EMPTY_PERMS).map((k) => ({ key: k as FeatureKey, label: k }));

  const save = useMutation({
    mutationFn: () =>
      editing && role
        ? updateRole(role.id, { name, description, baseRole, permissions })
        : createRole({ name, description, baseRole, permissions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const setAll = (value: boolean) => {
    setPermissions((prev) => {
      const next = { ...prev };
      for (const f of features) next[f.key] = value;
      return next;
    });
  };

  const messagingFeatures = features.filter((f) => MESSAGING_KEYS.includes(f.key));
  const otherFeatures = features.filter((f) => !MESSAGING_KEYS.includes(f.key));
  const opsKeys = new Set(['dashboard', 'orders', 'quotes', 'edits']);
  const moneyKeys = new Set(['customers', 'billing']);
  const adminKeys = new Set(['team', 'roles']);
  const leftoverFeatures = otherFeatures.filter(
    (f) => !opsKeys.has(f.key) && !moneyKeys.has(f.key) && !adminKeys.has(f.key),
  );

  const toggle = (key: FeatureKey, checked: boolean) => {
    setPermissions((p) => {
      const next = { ...p, [key]: checked };
      // Umbrella "Messages" toggles all messaging sub-permissions together.
      if (key === 'messages') {
        for (const mk of MESSAGING_KEYS) next[mk] = checked;
      } else if (MESSAGING_KEYS.includes(key) && checked) {
        next.messages = true;
      } else if (MESSAGING_KEYS.includes(key) && !checked) {
        const anySub = MESSAGING_KEYS.some(
          (mk) => mk !== 'messages' && mk !== key && next[mk],
        );
        if (!anySub) next.messages = false;
      }
      return next;
    });
  };

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>{editing ? 'Edit role' : 'Create role'}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>Role name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="ff">
            <label>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="ff">
            <label>Base system role</label>
            <select
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value as BaseRole)}
            >
              <option value="ADMIN">Admin</option>
              <option value="SUPPORT">Support</option>
              <option value="DESIGNER">Designer</option>
            </select>
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
              Used for system-level access (e.g. designer workload). Feature checkboxes control
              which admin screens this role can open.
            </div>
          </div>
          <div
            style={{
              marginTop: 8,
              marginBottom: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>Feature permissions</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>
                All
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>
                None
              </button>
            </span>
          </div>

          <div style={{ fontWeight: 600, fontSize: 12, margin: '10px 0 6px', color: 'var(--muted)' }}>
            Operations
          </div>
          <FeatureCheckboxGrid
            items={otherFeatures.filter((f) => opsKeys.has(f.key))}
            permissions={permissions}
            onToggle={toggle}
          />

          <div style={{ fontWeight: 600, fontSize: 12, margin: '12px 0 6px', color: 'var(--muted)' }}>
            Customers &amp; money
          </div>
          <FeatureCheckboxGrid
            items={otherFeatures.filter((f) => moneyKeys.has(f.key))}
            permissions={permissions}
            onToggle={toggle}
          />

          <div style={{ fontWeight: 600, fontSize: 12, margin: '12px 0 6px', color: 'var(--muted)' }}>
            Administration
          </div>
          <FeatureCheckboxGrid
            items={otherFeatures.filter((f) => adminKeys.has(f.key))}
            permissions={permissions}
            onToggle={toggle}
          />

          <div style={{ fontWeight: 600, fontSize: 12, margin: '12px 0 6px', color: 'var(--muted)' }}>
            Messages
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 6 }}>
            Grant Customer Messages, Team Messages, group chat, and delete separately.
          </div>
          <FeatureCheckboxGrid
            items={messagingFeatures}
            permissions={permissions}
            onToggle={toggle}
          />

          {leftoverFeatures.length > 0 && (
            <>
              <div style={{ fontWeight: 600, fontSize: 12, margin: '12px 0 6px', color: 'var(--muted)' }}>
                Other
              </div>
              <FeatureCheckboxGrid
                items={leftoverFeatures}
                permissions={permissions}
                onToggle={toggle}
              />
            </>
          )}

          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {editing ? 'Save role' : 'Create role'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersPanel() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<'create' | StaffUser | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', q, page],
    queryFn: () => listUsers({ q: q || undefined, page, pageSize: 20 }),
  });
  const users = data?.users ?? [];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          gap: 10,
          alignItems: 'center',
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <button type="button" className="btn btn-primary" onClick={() => setModal('create')}>
          <i className="ti ti-plus" /> Add user
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <ListToolbar
            search={q}
            onSearch={(v) => {
              setQ(v);
              setPage(1);
            }}
            searchPlaceholder="Search users…"
          />
        </div>
      </div>
      <div className="card">
        {isLoading && <div style={{ padding: 16 }}>Loading…</div>}
        {!isLoading && users.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>
            No staff users found. Add a user and assign a role.
          </div>
        )}
        {users.length > 0 && (
          <table className="qtable">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Login</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
                  </td>
                  <td>
                    {u.customRoleName || systemRoleLabel(u.role)}
                    {u.customRoleName && (
                      <div style={{ fontSize: 11, color: 'var(--faint)' }}>
                        {systemRoleLabel(u.role)}
                      </div>
                    )}
                  </td>
                  <td>{u.canLogin ? 'Can login' : 'Cannot login'}</td>
                  <td>{loginLabel(u.loginStatus)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setModal(u)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <PaginationBar
        page={data?.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        total={data?.total ?? 0}
        onPage={setPage}
      />
      {modal && (
        <UserFormModal
          user={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function UserFormModal({
  user,
  onClose,
}: {
  user: StaffUser | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = Boolean(user);
  const rolesQ = useQuery({ queryKey: ['admin-roles'], queryFn: listRoles });
  const [form, setForm] = useState({
    email: user?.email ?? '',
    password: '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phone: user?.phone ?? '',
    customRoleId: user?.customRoleId ?? '',
    systemRole: (user?.role && user.role !== 'CLIENT'
      ? user.role
      : 'SUPPORT') as SystemStaffRole,
    loginStatus: (user?.loginStatus ?? 'ACTIVE') as 'ACTIVE' | 'DISABLED' | 'PENDING',
  });
  const [error, setError] = useState<string | null>(null);
  const roles = rolesQ.data?.roles ?? [];

  const save = useMutation({
    mutationFn: () => {
      const customRoleId = form.customRoleId || null;
      if (editing && user) {
        if (form.password && form.password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }
        return updateUser(user.id, {
          firstName: form.firstName || null,
          lastName: form.lastName || null,
          phone: form.phone || null,
          customRoleId,
          role: customRoleId ? undefined : form.systemRole,
          loginStatus: form.loginStatus,
          password: form.password ? form.password : undefined,
        });
      }
      return createUser({
        email: form.email,
        password: form.password,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        phone: form.phone || null,
        customRoleId,
        loginStatus: form.loginStatus === 'PENDING' ? 'ACTIVE' : form.loginStatus,
        role: customRoleId ? undefined : form.systemRole,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const roleHint = useMemo(() => {
    if (!form.customRoleId) {
      return `System role: ${systemRoleLabel(form.systemRole)} (default feature access)`;
    }
    const r = roles.find((x) => x.id === form.customRoleId);
    if (!r) return '';
    const enabled = Object.entries(r.permissions)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ');
    return `Base: ${systemRoleLabel(r.baseRole)}${enabled ? ` · ${enabled}` : ''}`;
  }, [roles, form.customRoleId, form.systemRole]);

  const canSubmit = editing
    ? true
    : Boolean(form.email.trim()) && form.password.length >= 6;

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>{editing ? 'Edit user' : 'Create user'}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>First name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              autoFocus
            />
          </div>
          <div className="ff">
            <label>Last name</label>
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
          <div className="ff">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              disabled={editing}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {editing && (
              <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                Email cannot be changed after creation.
              </div>
            )}
          </div>
          <div className="ff">
            <label>{editing ? 'New password (optional)' : 'Password'}</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={6}
              placeholder={editing ? 'Leave blank to keep current' : undefined}
            />
          </div>
          <div className="ff">
            <label>Phone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="ff">
            <label>Assign custom role</label>
            <select
              value={form.customRoleId}
              onChange={(e) => setForm({ ...form, customRoleId: e.target.value })}
            >
              <option value="">None (use system role)</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {!form.customRoleId && (
            <div className="ff">
              <label>System role</label>
              <select
                value={form.systemRole}
                onChange={(e) =>
                  setForm({ ...form, systemRole: e.target.value as SystemStaffRole })
                }
              >
                <option value="SUPPORT">Support</option>
                <option value="DESIGNER">Designer</option>
                <option value="ADMIN">Admin</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </select>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 10 }}>{roleHint}</div>
          <div className="ff">
            <label>Can login / active status</label>
            <select
              value={form.loginStatus}
              onChange={(e) =>
                setForm({
                  ...form,
                  loginStatus: e.target.value as 'ACTIVE' | 'DISABLED' | 'PENDING',
                })
              }
            >
              <option value="ACTIVE">Active (can login)</option>
              <option value="DISABLED">Disabled (cannot login)</option>
              {editing && <option value="PENDING">Pending</option>}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.isPending || !canSubmit}
            onClick={() => save.mutate()}
          >
            {editing ? 'Save user' : 'Create user'}
          </button>
        </div>
      </div>
    </div>
  );
}
