import { useEffect, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Brand, LogoutLink, Shell, useShellUser } from './Shell';
import { TeamChatPanel } from './TeamChatPanel';
import { getTeamChatOwner, listTeam, type Presence } from '@/lib/team';
import type { UserRole } from '@/lib/types';

type ViewRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'DESIGNER';

const ROLE_META: Record<
  ViewRole,
  { label: string; seg: string; sideSub: string; footRole: string }
> = {
  SUPER_ADMIN: {
    label: 'Super Admin',
    seg: 'super',
    sideSub: 'Command center',
    footRole: 'Owner · Super Admin',
  },
  ADMIN: {
    label: 'Admin',
    seg: 'admin',
    sideSub: 'Operations',
    footRole: 'Admin · Operations',
  },
  SUPPORT: {
    label: 'Support',
    seg: 'support',
    sideSub: 'Support desk',
    footRole: 'Support',
  },
  DESIGNER: {
    label: 'Designer',
    seg: 'designer',
    sideSub: 'Designer workspace',
    footRole: 'Designer',
  },
};

function roleKey(role: UserRole): ViewRole {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'SUPPORT' || role === 'DESIGNER') {
    return role;
  }
  return 'ADMIN';
}

function canSee(roles: string, view: ViewRole) {
  return roles.split(',').includes(ROLE_META[view].seg);
}

function presenceColor(p: Presence) {
  if (p === 'ON') return 'var(--green)';
  if (p === 'AWAY') return 'var(--amber)';
  return '#c3c9d1';
}

function memberLabel(m: { firstName: string | null; lastName: string | null; email: string }) {
  return [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email.split('@')[0];
}

export function AdminShell() {
  const { user, initials, name, onLogout } = useShellUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const actual = roleKey(user?.role ?? 'ADMIN');
  const [viewAs, setViewAs] = useState<ViewRole>(actual);
  const [chatPeerId, setChatPeerId] = useState<string | null>(null);

  useEffect(() => {
    setViewAs(actual);
  }, [actual]);

  const teamParam = searchParams.get('team');
  useEffect(() => {
    if (!teamParam) return;
    setChatPeerId(teamParam);
    const next = new URLSearchParams(searchParams);
    next.delete('team');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to team param
  }, [teamParam]);

  const { data: teamData } = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
    refetchInterval: 60_000,
  });
  const members = (teamData?.members ?? []).filter((m) => m.id !== user?.id);
  const onlineCount = (teamData?.members ?? []).filter((m) => m.presence === 'ON').length;
  const meta = ROLE_META[viewAs];

  const rolebar =
    actual === 'SUPER_ADMIN' ? (
      <div className="rolebar">
        <div className="rb-l">
          Viewing as
          <div className="seg">
            {(Object.keys(ROLE_META) as ViewRole[]).map((r) => (
              <button
                key={r}
                type="button"
                className={viewAs === r ? 'on' : ''}
                onClick={() => setViewAs(r)}
              >
                {ROLE_META[r].label}
              </button>
            ))}
          </div>
        </div>
        <div className="rb-r">
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{onlineCount} online</span>
        </div>
      </div>
    ) : undefined;

  const sidebar = (
    <aside className="side">
      <Brand subtitle={meta.sideSub} />
      <nav className="nav" id="nav">
        {canSee('super,admin,support', viewAs) && (
          <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-home" /> Dashboard
          </NavLink>
        )}
        {canSee('designer', viewAs) && (
          <NavLink to="/admin/mywork" className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-briefcase" /> My work
          </NavLink>
        )}
        {canSee('super,admin,support,designer', viewAs) && (
          <>
            <NavLink to="/admin/messages" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-message" /> Messages
            </NavLink>
            <NavLink to="/admin/orders" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-package" /> Orders
            </NavLink>
          </>
        )}
        {canSee('super,admin,support', viewAs) && (
          <>
            <NavLink to="/admin/quotes" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-file-invoice" /> Quotes
            </NavLink>
            <NavLink to="/admin/edits" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-refresh" /> Edits
            </NavLink>
            <NavLink to="/admin/customers" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-users" /> Customers
            </NavLink>
          </>
        )}
        {canSee('designer', viewAs) && (
          <NavLink to="/admin/edits" className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-refresh" /> Edits
          </NavLink>
        )}
        {canSee('super,admin', viewAs) && (
          <>
            <div className="divider">Money</div>
            <NavLink to="/admin/billing" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-cash" /> Billing &amp; invoices
            </NavLink>
          </>
        )}
        {canSee('super,admin,support', viewAs) && (
          <NavLink
            to="/admin/login-requests"
            className={({ isActive }) => (isActive ? 'on' : undefined)}
          >
            <i className="ti ti-user-plus" /> Login requests
          </NavLink>
        )}
        {canSee('super', viewAs) && (
          <>
            <div className="divider">Team</div>
            <NavLink to="/admin/team" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-users-group" /> Team{' '}
              <span className="cnt" id="team-online">
                {onlineCount} on
              </span>
            </NavLink>
            <NavLink to="/admin/roles" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-shield-lock" /> Roles &amp; users
            </NavLink>
          </>
        )}
        {canSee('super,admin', viewAs) &&
          members.slice(0, 6).map((m) => (
            <a
              key={m.id}
              href="#team-chat"
              style={{ padding: '6px 11px' }}
              onClick={(e) => {
                e.preventDefault();
                setChatPeerId(m.id);
              }}
            >
              <span className="tm-dot" style={{ background: presenceColor(m.presence) }} />
              {memberLabel(m)}
            </a>
          ))}
        {canSee('designer,support,admin', viewAs) && !canSee('super', viewAs) && (
          <>
            <div className="divider">Chat</div>
            <a
              href="#owner-chat"
              style={{ padding: '6px 11px' }}
              onClick={(e) => {
                e.preventDefault();
                void getTeamChatOwner().then((res) => {
                  if (res.peerId) setChatPeerId(res.peerId);
                });
              }}
            >
              <span className="tm-dot" style={{ background: 'var(--green)' }} /> Message owner
            </a>
          </>
        )}
      </nav>
      <div className="foot">
        <div className="me">
          <div className="av" id="me-av">
            {initials}
          </div>
          <div>
            <div className="mn" id="me-name">
              {name}
            </div>
            <div className="mr" id="me-role">
              {ROLE_META[actual].footRole}
            </div>
          </div>
        </div>
        <LogoutLink onClick={() => void onLogout()} />
      </div>
    </aside>
  );

  return (
    <>
      <Shell rolebar={rolebar} sidebar={sidebar} />
      {chatPeerId && (
        <TeamChatPanel peerId={chatPeerId} onClose={() => setChatPeerId(null)} />
      )}
    </>
  );
}
