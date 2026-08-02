import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { getErrorMessage } from '@/lib/api';
import {
  createRole,
  createUser,
  deleteRole,
  listRoleFeatures,
  listRoles,
  listUsers,
  updateUser,
  type CustomRole,
  type FeatureKey,
} from '@/lib/roles';

type Tab = 'roles' | 'users';

const EMPTY_PERMS: Record<FeatureKey, boolean> = {
  dashboard: true,
  messages: true,
  orders: true,
  quotes: true,
  edits: true,
  customers: true,
  billing: false,
  team: false,
  roles: false,
};

export function AdminRolesUsers() {
  const [tab, setTab] = useState<Tab>('roles');
  return (
    <div>
      <div className="ph">
        <div>
          <h1>Roles &amp; users</h1>
          <div className="sub">
            Create roles with feature permissions, then create users and assign roles.
          </div>
        </div>
      </div>
      <div className="filters" style={{ marginBottom: 14 }}>
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
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['admin-roles'], queryFn: listRoles });
  const roles = data?.roles ?? [];

  const del = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-roles'] }),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
          <i className="ti ti-plus" /> Add role
        </button>
      </div>
      <div className="card">
        {isLoading && <div style={{ padding: 16 }}>Loading…</div>}
        {!isLoading && roles.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No custom roles yet.</div>
        )}
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
            {roles.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                  {r.description && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.description}</div>
                  )}
                </td>
                <td>{r.baseRole}</td>
                <td style={{ fontSize: 12 }}>
                  {Object.entries(r.permissions)
                    .filter(([, v]) => v)
                    .map(([k]) => k)
                    .join(', ') || '—'}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => del.mutate(r.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showNew && <NewRoleModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewRoleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const featuresQ = useQuery({ queryKey: ['role-features'], queryFn: listRoleFeatures });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseRole, setBaseRole] = useState<'ADMIN' | 'SUPPORT' | 'DESIGNER'>('SUPPORT');
  const [permissions, setPermissions] = useState(EMPTY_PERMS);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createRole({ name, description, baseRole, permissions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Create role</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>Role name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="ff">
            <label>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="ff">
            <label>Base system role</label>
            <select
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value as typeof baseRole)}
            >
              <option value="ADMIN">Admin</option>
              <option value="SUPPORT">Support</option>
              <option value="DESIGNER">Designer</option>
            </select>
          </div>
          <div style={{ marginTop: 8, marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
            Feature permissions
          </div>
          {(featuresQ.data?.features ?? Object.keys(EMPTY_PERMS).map((k) => ({ key: k as FeatureKey, label: k }))).map(
            (f) => (
              <label
                key={f.key}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={!!permissions[f.key]}
                  onChange={(e) =>
                    setPermissions((p) => ({ ...p, [f.key]: e.target.checked }))
                  }
                />
                {f.label}
              </label>
            ),
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Create role
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', q, page],
    queryFn: () => listUsers({ q: q || undefined, page, pageSize: 20 }),
  });
  const users = data?.users ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <ListToolbar
          search={q}
          onSearch={(v) => {
            setQ(v);
            setPage(1);
          }}
          searchPlaceholder="Search users…"
        />
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
          <i className="ti ti-plus" /> Add user
        </button>
      </div>
      <div className="card">
        {isLoading && <div style={{ padding: 16 }}>Loading…</div>}
        <table className="qtable">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Login</th>
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
                <td>{u.customRoleName || u.role}</td>
                <td>
                  <select
                    value={u.loginStatus}
                    onChange={(e) =>
                      updateUser(u.id, {
                        loginStatus: e.target.value as 'ACTIVE' | 'DISABLED' | 'PENDING',
                      }).then(() => qc.invalidateQueries({ queryKey: ['admin-users'] }))
                    }
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="DISABLED">Disabled</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>{u.presence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar
        page={data?.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        total={data?.total ?? 0}
        onPage={setPage}
      />
      {showNew && <NewUserModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const rolesQ = useQuery({ queryKey: ['admin-roles'], queryFn: listRoles });
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    customRoleId: '',
    loginStatus: 'ACTIVE' as const,
  });
  const [error, setError] = useState<string | null>(null);
  const roles = rolesQ.data?.roles ?? [];

  const create = useMutation({
    mutationFn: () =>
      createUser({
        email: form.email,
        password: form.password,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        phone: form.phone || null,
        customRoleId: form.customRoleId || null,
        loginStatus: form.loginStatus,
        role: form.customRoleId ? undefined : 'SUPPORT',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const roleHint = useMemo(() => {
    const r: CustomRole | undefined = roles.find((x) => x.id === form.customRoleId);
    return r ? `Base: ${r.baseRole}` : 'Default support role if none selected';
  }, [roles, form.customRoleId]);

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Create user</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>Name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              placeholder="First name"
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
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="ff">
            <label>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={6}
            />
          </div>
          <div className="ff">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="ff">
            <label>Assign role</label>
            <select
              value={form.customRoleId}
              onChange={(e) => setForm({ ...form, customRoleId: e.target.value })}
            >
              <option value="">— System Support —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>{roleHint}</div>
          </div>
          <div className="ff">
            <label>Can login / active</label>
            <select
              value={form.loginStatus}
              onChange={(e) =>
                setForm({ ...form, loginStatus: e.target.value as 'ACTIVE' })
              }
            >
              <option value="ACTIVE">Active (can login)</option>
              <option value="DISABLED">Disabled</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending || !form.email || form.password.length < 6}
            onClick={() => create.mutate()}
          >
            Create user
          </button>
        </div>
      </div>
    </div>
  );
}
