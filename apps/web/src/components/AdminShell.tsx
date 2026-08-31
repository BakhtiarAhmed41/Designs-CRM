import { useEffect, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, LogoutLink, Shell, useShellUser } from './Shell';
import { TeamChatPanel } from './TeamChatPanel';
import { GlobalSearch } from './GlobalSearch';
import { listLoginRequests } from '@/lib/auth';
import { getDashboardStats } from '@/lib/dashboard';
import { getTeamChatOwner, getTeamUnreadSummary, listTeam, type Presence } from '@/lib/team';
import { getAdminUnreadSummary } from '@/lib/messaging';
import { canAnyMessaging, featuresForUser } from '@/lib/permissions';
import type { FeatureKey, UserRole } from '@/lib/types';
import { whenVisible } from '@/lib/queryRefresh';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

const ROLE_META: Record<
  'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'DESIGNER',
  { label: string; sideSub: string }
> = {
  SUPER_ADMIN: { label: 'Super Admin', sideSub: 'Command center' },
  ADMIN: { label: 'Admin', sideSub: 'Operations' },
  SUPPORT: { label: 'Support', sideSub: 'Support desk' },
  DESIGNER: { label: 'Designer', sideSub: 'Designer workspace' },
};

function roleKey(role: UserRole): keyof typeof ROLE_META {
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
  const { user, onLogout } = useShellUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = roleKey(user?.role ?? 'ADMIN');
  const [chatPeerId, setChatPeerId] = useState<string | null>(null);

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
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchInterval: whenVisible(60_000),
  });
  const members = (teamData?.members ?? []).filter((m) => m.id !== user?.id);
  const onlineCount = (teamData?.members ?? []).filter((m) => m.presence === 'ON').length;
  const meta = ROLE_META[role];
  const features = featuresForUser(role, user?.permissions);
  const can = (key: FeatureKey) => Boolean(features[key]);
  const isDesigner = role === 'DESIGNER';
  const showReports = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const showMessages = canAnyMessaging(features);
  const showCustomerMessages = can('messages_customer_view');
  const showTeamMessages = can('messages') || can('messages_team_view');
  const showMyWork = isDesigner || (!can('dashboard') && can('orders'));
  const showOwnerChat = role !== 'SUPER_ADMIN' && (showTeamMessages || isDesigner);

  const { data: customerUnread } = useQuery({
    queryKey: ['admin-unread-messages'],
    queryFn: getAdminUnreadSummary,
    enabled: showCustomerMessages,
    refetchInterval: whenVisible(20_000),
  });
  const { data: teamUnread } = useQuery({
    queryKey: ['team-unread'],
    queryFn: getTeamUnreadSummary,
    enabled: showTeamMessages,
    refetchInterval: whenVisible(20_000),
  });
  const { data: loginRequests } = useQuery({
    queryKey: ['login-requests'],
    queryFn: listLoginRequests,
    enabled: can('customers'),
    refetchInterval: whenVisible(30_000),
  });
  const { data: navStats } = useQuery({
    queryKey: ['admin-dashboard-stats'],
    queryFn: getDashboardStats,
    enabled: can('quotes') || can('orders'),
    refetchInterval: whenVisible(30_000),
  });
  useMessagingSocket({
    onUnreadChanged: () => {
      void qc.invalidateQueries({ queryKey: ['admin-unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
    },
  });
  const customerBadge = customerUnread?.unreadConversations ?? 0;
  const teamBadge = (teamUnread?.dmUnread ?? 0) + (teamUnread?.groupUnread ?? 0);
  const loginRequestBadge = loginRequests?.requests?.length ?? 0;
  const quoteBadge = navStats?.stats.quotesToPrice ?? 0;
  const orderBadge = navStats?.stats.newOrders ?? 0;

  const sidebar = (
    <aside className="side">
      <Brand subtitle={meta.sideSub} />
      <nav className="nav" id="nav">
        {(can('dashboard') || showReports) && (
          <>
            <div className="divider">Overview</div>
            {can('dashboard') && (
              <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-home" /> Dashboard
              </NavLink>
            )}
            {showReports && (
              <NavLink to="/admin/reports" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-chart-bar" /> Reports
              </NavLink>
            )}
          </>
        )}
        {showMessages && (
          <>
            <div className="divider">Messages</div>
            {showCustomerMessages && (
              <NavLink
                to="/admin/messages/customers"
                className={({ isActive }) => (isActive ? 'on' : undefined)}
              >
                <i className="ti ti-message-circle" /> Customer inbox
                {customerBadge > 0 && <span className="cnt">{customerBadge}</span>}
              </NavLink>
            )}
            {showTeamMessages && (
              <NavLink
                to="/admin/messages/team"
                className={({ isActive }) => (isActive ? 'on' : undefined)}
              >
                <i className="ti ti-messages" /> Team inbox
                {teamBadge > 0 && <span className="cnt">{teamBadge}</span>}
              </NavLink>
            )}
          </>
        )}
        {(showMyWork || can('orders') || can('quotes') || can('edits')) && (
          <>
            <div className="divider">Work</div>
            {showMyWork && (
              <NavLink to="/admin/mywork" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-briefcase" /> My work
              </NavLink>
            )}
            {can('orders') && (
              <NavLink to="/admin/orders" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-package" /> Orders
                {orderBadge > 0 && <span className="cnt">{orderBadge}</span>}
              </NavLink>
            )}
            {can('quotes') && (
              <NavLink to="/admin/quotes" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-file-invoice" /> Quotes
                {quoteBadge > 0 && <span className="cnt">{quoteBadge}</span>}
              </NavLink>
            )}
            {can('edits') && (
              <NavLink to="/admin/edits" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-refresh" /> Revisions
              </NavLink>
            )}
          </>
        )}
        {can('customers') && (
          <>
            <div className="divider">Customers</div>
            <NavLink to="/admin/customers" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-users" /> All customers
            </NavLink>
            <NavLink
              to="/admin/login-requests"
              className={({ isActive }) => (isActive ? 'on' : undefined)}
            >
              <i className="ti ti-user-plus" /> Login requests
              {loginRequestBadge > 0 && <span className="cnt">{loginRequestBadge}</span>}
            </NavLink>
          </>
        )}
        {can('billing') && (
          <>
            <div className="divider">Billing</div>
            <NavLink to="/admin/billing" className={({ isActive }) => (isActive ? 'on' : undefined)}>
              <i className="ti ti-cash" /> Invoices
            </NavLink>
          </>
        )}
        {(can('team') || can('roles') || showOwnerChat) && (
          <>
            <div className="divider">Team</div>
            {can('team') && (
              <NavLink to="/admin/team" className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <i className="ti ti-users-group" /> People{' '}
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
            )}
          </>
        )}
      </nav>
      <div className="foot">
        <LogoutLink onClick={() => void onLogout()} />
      </div>
    </aside>
  );

  return (
    <>
      <Shell
        sidebar={sidebar}
        brandLabel={meta.sideSub}
        contextLabel={meta.label}
        topbarSearch={<GlobalSearch />}
        mobileItems={[
          ...(can('dashboard')
            ? [{ to: '/admin', label: 'Home', icon: 'ti-home', end: true }]
            : []),
          ...(showMyWork
            ? [{ to: '/admin/mywork', label: 'Work', icon: 'ti-briefcase' }]
            : can('orders')
              ? [{ to: '/admin/orders', label: 'Orders', icon: 'ti-package' }]
              : []),
          ...(can('quotes')
            ? [{ to: '/admin/quotes', label: 'Quotes', icon: 'ti-file-invoice' }]
            : []),
          ...(showMessages
            ? [
                {
                  to: showCustomerMessages
                    ? '/admin/messages/customers'
                    : '/admin/messages/team',
                  label: 'Inbox',
                  icon: 'ti-message-circle',
                },
              ]
            : []),
        ]}
      />
      {chatPeerId && (
        <TeamChatPanel peerId={chatPeerId} onClose={() => setChatPeerId(null)} />
      )}
    </>
  );
}
