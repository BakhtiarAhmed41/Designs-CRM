import { useEffect, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, LogoutLink, Shell, useShellUser } from './Shell';
import { TeamChatPanel } from './TeamChatPanel';
import { listLoginRequests } from '@/lib/auth';
import { getTeamChatOwner, getTeamUnreadSummary, listTeam, type Presence } from '@/lib/team';
import { getAdminUnreadSummary } from '@/lib/messaging';
import { canAnyMessaging, featuresForNav } from '@/lib/permissions';
import type { FeatureKey, UserRole } from '@/lib/types';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

type ViewRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'DESIGNER';

const ROLE_META: Record<
  ViewRole,
  { label: string; sideSub: string; footRole: string }
> = {
  SUPER_ADMIN: {
    label: 'Super Admin',
    sideSub: 'Command center',
    footRole: 'Owner · Super Admin',
  },
  ADMIN: {
    label: 'Admin',
    sideSub: 'Operations',
    footRole: 'Admin · Operations',
  },
  SUPPORT: {
    label: 'Support',
    sideSub: 'Support desk',
    footRole: 'Support',
  },
  DESIGNER: {
    label: 'Designer',
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

  const qc = useQueryClient();
  const { data: teamData } = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
    refetchInterval: 60_000,
  });
  const members = (teamData?.members ?? []).filter((m) => m.id !== user?.id);
  const onlineCount = (teamData?.members ?? []).filter((m) => m.presence === 'ON').length;
  const meta = ROLE_META[viewAs];
  const features = featuresForNav(actual, viewAs, user?.permissions);
  const can = (key: FeatureKey) => Boolean(features[key]);
  const isDesignerView = viewAs === 'DESIGNER';
  const showMessages = canAnyMessaging(features);
  const showCustomerMessages = can('messages') || can('messages_customer_view');
  const showTeamMessages = can('messages') || can('messages_team_view');
  const showOwnerChat =
    viewAs !== 'SUPER_ADMIN' && (showTeamMessages || isDesignerView);

  const { data: customerUnread } = useQuery({
    queryKey: ['admin-unread-messages'],
    queryFn: getAdminUnreadSummary,
    enabled: showCustomerMessages,
    refetchInterval: 20_000,
  });
  const { data: teamUnread } = useQuery({
    queryKey: ['team-unread'],
    queryFn: getTeamUnreadSummary,
    enabled: showTeamMessages,
    refetchInterval: 20_000,
  });
  const { data: loginRequests } = useQuery({
    queryKey: ['login-requests'],
    queryFn: listLoginRequests,
    enabled: can('customers'),
    refetchInterval: 30_000,
  });
  useMessagingSocket({
    onUnreadChanged: () => {
      void qc.invalidateQueries({ queryKey: ['admin-unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
    },
  });
  const customerBadge = customerUnread?.unreadConversations ?? 0;
  const teamBadge =
    (teamUnread?.dmUnread ?? 0) + (teamUnread?.groupUnread ?? 0);
  const loginRequestBadge = loginRequests?.requests?.length ?? 0;

  const rolebar =
    actual === 'SUPER_ADMIN' ? (
      <div className="rolebar">
        <div className="rb-l">
          Preview nav as
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
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            Sidebar only · {onlineCount} online
          </span>
        </div>
      </div>
    ) : undefined;

  const sidebar = (
    <aside className="side">
      <Brand subtitle={meta.sideSub} />
      <nav className="nav" id="nav">
        {can('dashboard') && (
          <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-home" /> Dashboard
          </NavLink>
        )}
        {isDesignerView && (
          <NavLink to="/admin/mywork" className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-briefcase" /> My work
          </NavLink>
        )}
        {showMessages && (
          <>
            <div className="divider">Messages</div>
            {showCustomerMessages && (
              <NavLink
                to="/admin/messages/customers"
                className={({ isActive }) => (isActive ? 'on' : undefined)}
              >
                <i className="ti ti-message-circle" /> Customer Messages
                {customerBadge > 0 && <span className="cnt">{customerBadge}</span>}
              </NavLink>
            )}
            {showTeamMessages && (
              <NavLink
                to="/admin/messages/team"
                className={({ isActive }) => (isActive ? 'on' : undefined)}
              >
                <i className="ti ti-messages" /> Team Messages
                {teamBadge > 0 && <span className="cnt">{teamBadge}</span>}
              </NavLink>
            )}
          </>
        )}
        {can('orders') && (
          <NavLink to="/admin/orders" className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-package" /> Orders
          </NavLink>
        )}
        {can('quotes') && (
          <NavLink to="/admin/quotes" className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-file-invoice" /> Quotes
          </NavLink>
        )}
        {can('edits') && (
          <NavLink to="/admin/edits" className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-refresh" /> Edits
          </NavLink>
        )}
        {can('customers') && (
          <NavLink to="/admin/customers" className={({ isActive }) => (isActive ? 'on' : undefined)}>
            <i className="ti ti-users" /> Customers
          </NavLink>
        )}
        {can('billing') && (
          <>
            <div className="divider">Money</div>
            <NavLink to="/admin/billing" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-cash" /> Billing &amp; invoices
            </NavLink>
          </>
        )}
        {can('customers') && (
          <NavLink
            to="/admin/login-requests"
            className={({ isActive }) => (isActive ? 'on' : undefined)}
          >
            <i className="ti ti-user-plus" /> Login requests
            {loginRequestBadge > 0 && <span className="cnt">{loginRequestBadge}</span>}
          </NavLink>
        )}
        {(can('team') || can('roles')) && (
          <>
            <div className="divider">Team</div>
            {can('team') && (
              <NavLink to="/admin/team" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-users-group" /> Team{' '}
                <span className="cnt" id="team-online">
                  {onlineCount} on
                </span>
              </NavLink>
            )}
            {can('roles') && (
              <NavLink to="/admin/roles" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-shield-lock" /> Roles &amp; users
              </NavLink>
            )}
          </>
        )}
        {can('team') &&
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
        {showOwnerChat && (
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
