import { Outlet, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';

export function Shell({
  rolebar,
  sidebar,
}: {
  rolebar?: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div>
      {rolebar}
      <div className="shell">
        {sidebar}
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function useShellUser() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const initials =
    (user?.firstName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase() +
    (user?.lastName?.[0] ?? '').toUpperCase();
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'User';

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return { user, initials, name, onLogout };
}

export function Brand({ subtitle }: { subtitle: string }) {
  return (
    <div className="brand">
      <img src="/lvd-logo.png" alt="LVD" style={{ height: 34, width: 'auto', flexShrink: 0 }} />
      <div>
        <div className="bt">Las Vegas Designs USA</div>
        <div className="bs">{subtitle}</div>
      </div>
    </div>
  );
}

export function LogoutLink({ onClick }: { onClick: () => void }) {
  return (
    <a
      className="logout-link"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <i className="ti ti-logout" /> Logout
    </a>
  );
}
