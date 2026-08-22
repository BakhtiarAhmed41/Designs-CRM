import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTeamMember,
  listTeam,
  setMyPresence,
  updateTeamMember,
  type CreateTeamMemberInput,
  type Presence,
  type TeamMember,
} from '@/lib/team';
import { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/lib/types';

type TeamFilter = '' | UserRole | 'online';

const STAFF_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'DESIGNER'];
const PRESENCE_OPTIONS: Presence[] = ['ON', 'AWAY', 'OFF'];

function roleLabel(role: UserRole): string {
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

function rolePill(role: UserRole): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'role-pill rp-super';
    case 'ADMIN':
      return 'role-pill rp-admin';
    case 'SUPPORT':
      return 'role-pill rp-support';
    case 'DESIGNER':
      return 'role-pill rp-designer';
    default:
      return 'role-pill rp-admin';
  }
}

function presenceClass(p: Presence): string {
  if (p === 'ON') return 'pres-txt pres-on';
  if (p === 'AWAY') return 'pres-txt pres-away';
  return 'pres-txt pres-off';
}

function presenceLabel(p: Presence): string {
  if (p === 'ON') return 'Online';
  if (p === 'AWAY') return 'Away';
  return 'Offline';
}

export function AdminTeam() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = Boolean(user?.permissions?.features?.team);
  const [filter, setFilter] = useState<TeamFilter>('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [supportPerms, setSupportPerms] = useState({
    money: false,
    approve: false,
    netTerms: false,
    messages: true,
  });
  const [permsHydrated, setPermsHydrated] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
    refetchInterval: 30_000,
  });

  const members = useMemo(() => {
    let list = data?.members ?? [];
    if (filter === 'online') list = list.filter((m) => m.presence === 'ON');
    else if (filter) list = list.filter((m) => m.role === filter);
    return list;
  }, [data?.members, filter]);

  useEffect(() => {
    if (permsHydrated || !data?.members) return;
    const support = data.members.find((m) => m.role === 'SUPPORT');
    if (support?.permissions) {
      setSupportPerms({
        money: Boolean(support.permissions.money),
        approve: Boolean(support.permissions.approve),
        netTerms: Boolean(support.permissions.netTerms),
        messages: support.permissions.messages !== false,
      });
    }
    setPermsHydrated(true);
  }, [data?.members, permsHydrated]);

  const saveSupportPerms = useMutation({
    mutationFn: async () => {
      const support = (data?.members ?? []).filter((m) => m.role === 'SUPPORT');
      await Promise.all(
        support.map((m) =>
          updateTeamMember(m.id, {
            permissions: {
              money: supportPerms.money,
              approve: supportPerms.approve,
              netTerms: supportPerms.netTerms,
              messages: supportPerms.messages,
            },
          }),
        ),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-team'] }),
  });

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Team</h1>
          <div className="sub">People, roles, presence, and assigned work.</div>
        </div>
        {canManage && (
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
            <i className="ti ti-plus" /> Add member
          </button>
        )}
      </div>

      <div>
        <div className="filters">
          <button type="button" className={filter === '' ? 'on' : ''} onClick={() => setFilter('')}>
            All
          </button>
          <button
            type="button"
            className={filter === 'ADMIN' || filter === 'SUPER_ADMIN' ? 'on' : ''}
            onClick={() => setFilter('ADMIN')}
          >
            Admins
          </button>
          <button
            type="button"
            className={filter === 'DESIGNER' ? 'on' : ''}
            onClick={() => setFilter('DESIGNER')}
          >
            Designers
          </button>
          <button
            type="button"
            className={filter === 'SUPPORT' ? 'on' : ''}
            onClick={() => setFilter('SUPPORT')}
          >
            Support
          </button>
          <button
            type="button"
            className={filter === 'online' ? 'on' : ''}
            onClick={() => setFilter('online')}
          >
            Online now
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
        <table className="qtable">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Skills</th>
              <th>Presence</th>
              <th>Workload</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--muted)' }}>
                  Loading...
                </td>
              </tr>
            )}
            {members.map((m) => (
              <TeamRow
                key={m.id}
                member={m}
                canManage={canManage}
                isMe={m.id === user?.id}
                onEdit={() => setEditing(m)}
              />
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-adjustments" /> Support role permissions
          </span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>what Support can do</span>
        </div>
        <div style={{ padding: '6px 16px 12px' }}>
          <PermRow
            title="Send invoices & take payment"
            desc="Let support handle money, not just messages"
            checked={supportPerms.money}
            onChange={(v) => setSupportPerms((p) => ({ ...p, money: v }))}
          />
          <PermRow
            title="Approve & release designer files"
            desc="Off by default. Approvals stay with you."
            checked={supportPerms.approve}
            onChange={(v) => setSupportPerms((p) => ({ ...p, approve: v }))}
          />
          <PermRow
            title="Grant net-monthly terms"
            desc="Off by default. You decide who gets credit."
            checked={supportPerms.netTerms}
            onChange={(v) => setSupportPerms((p) => ({ ...p, netTerms: v }))}
          />
          <PermRow
            title="View & reply to all messages"
            desc="Core support ability"
            checked={supportPerms.messages}
            onChange={(v) => setSupportPerms((p) => ({ ...p, messages: v }))}
          />
          {canManage && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 8 }}
              disabled={saveSupportPerms.isPending}
              onClick={() => saveSupportPerms.mutate()}
            >
              Save support permissions
            </button>
          )}
        </div>
      </div>

      <div className="note">
        <i className="ti ti-info-circle" /> Roles control what each person sees: <b>Super Admin</b> everything ·{' '}
        <b>Admin</b> operations &amp; money · <b>Support</b> messages &amp; customers (money is a toggle above) ·{' '}
        <b>Designer</b> only assigned work, no money. Designer files route to you for approval before reaching the
        customer.
      </div>

      {showNew && <NewMemberModal onClose={() => setShowNew(false)} />}
      {editing && <EditMemberModal member={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TeamRow({
  member: m,
  canManage,
  isMe,
  onEdit,
}: {
  member: TeamMember;
  canManage: boolean;
  isMe: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;

  const presenceMut = useMutation({
    mutationFn: (p: Presence) => setMyPresence(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-team'] }),
  });

  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="othumb" style={{ width: 34, height: 34, fontSize: 12 }}>
            {m.initials ?? m.email.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{name}</div>
            <div style={{ fontSize: 11, color: 'var(--faint)' }}>{m.email}</div>
          </div>
        </div>
      </td>
      <td>
        <span className={rolePill(m.role)}>{roleLabel(m.role)}</span>
      </td>
      <td>
        {m.skills.map((s) => (
          <span key={s} className="skill">
            {s}
          </span>
        ))}
        {m.skills.length === 0 && <span style={{ color: 'var(--faint)' }}>None</span>}
      </td>
      <td>
        {isMe ? (
          <select
            value={m.presence}
            disabled={presenceMut.isPending}
            onChange={(e) => presenceMut.mutate(e.target.value as Presence)}
            className="stat-select"
            style={{ fontSize: 12 }}
          >
            {PRESENCE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {presenceLabel(p)}
              </option>
            ))}
          </select>
        ) : (
          <span className={presenceClass(m.presence)}>{presenceLabel(m.presence)}</span>
        )}
      </td>
      <td>
        <span className="badge" style={{ background: 'var(--tint)', color: 'var(--navy)' }}>
          {m.workload}
        </span>
      </td>
      {canManage && (
        <td>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            Edit
          </button>
        </td>
      )}
    </tr>
  );
}

function PermRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="perm-row">
      <div style={{ flex: 1 }}>
        <div className="pt">{title}</div>
        <div className="pd">{desc}</div>
      </div>
      <label className="tog">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="sl" />
      </label>
    </div>
  );
}

function NewMemberModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateTeamMemberInput>({
    email: '',
    password: '',
    role: 'DESIGNER',
    firstName: null,
    skills: [],
  });
  const [skillsText, setSkillsText] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createTeamMember({
        ...form,
        skills: skillsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-team'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Add team member</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>First name</label>
            <input
              value={form.firstName ?? ''}
              onChange={(e) => setForm({ ...form, firstName: e.target.value || null })}
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
            <label>Temporary password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="ff">
            <label>Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Skills (comma separated)</label>
            <input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.email.trim() || form.password.length < 8}
          >
            {create.isPending ? 'Creating…' : 'Create member'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMemberModal({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(member.firstName ?? '');
  const [lastName, setLastName] = useState(member.lastName ?? '');
  const [role, setRole] = useState<UserRole>(member.role);
  const [skillsText, setSkillsText] = useState(member.skills.join(', '));

  const save = useMutation({
    mutationFn: () =>
      updateTeamMember(member.id, {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        role,
        skills: skillsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-team'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Edit {member.email}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="ff">
            <label>Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="ff">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Skills (comma separated)</label>
            <input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
