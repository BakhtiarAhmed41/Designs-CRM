import { cloneElement, Suspense, useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { NotificationBell } from './NotificationBell';
import { AccountMenu } from './AccountMenu';
import { PageLoading } from './PageProgress';

export type MobileNavItem = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
};

function isMessagingPath(pathname: string, search = '') {
  if (pathname.startsWith('/portal/messages')) {
    return new URLSearchParams(search).has('c');
  }
  if (pathname.startsWith('/admin/messages/customers')) {
    return /\/admin\/messages\/customers\/[^/]+/.test(pathname);
  }
  return pathname.includes('/messages');
}

export function Shell({
  rolebar,
  sidebar,
  mobileItems,
  brandLabel = 'Las Vegas Designs',
  topbarSearch,
  contextLabel,
}: {
  rolebar?: ReactNode;
  sidebar: ReactNode;
  mobileItems?: MobileNavItem[];
  brandLabel?: string;
  topbarSearch?: ReactNode;
  contextLabel?: string;
}) {
  const { pathname, search } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const messaging = isMessagingPath(pathname, search);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const side = cloneElement(sidebar as ReactElement<{ className?: string }>, {
    className: [((sidebar as ReactElement<{ className?: string }>).props.className ?? ''), navOpen ? 'open' : '']
      .filter(Boolean)
      .join(' '),
  });

  return (
    <div className={`app-frame${rolebar ? ' with-rolebar' : ''}`}>
      {rolebar}
      <header className="mobile-top">
        <button
          type="button"
          className="icon-btn"
          aria-label="Open menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <i className="ti ti-menu-2" />
        </button>
        <div className="brand-mini">{brandLabel}</div>
        <div className="mobile-top-right">
          <NotificationBell />
          <AccountMenu contextLabel={contextLabel} />
        </div>
      </header>
      <div
        className={`side-backdrop${navOpen ? ' open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden={!navOpen}
      />
      <div className="shell">
        {side}
        <div className="workspace-col">
          <header className="app-topbar">
            {topbarSearch ? <div className="top-search">{topbarSearch}</div> : <div className="top-spacer" />}
            <div className="top-right">
              <NotificationBell />
              <AccountMenu contextLabel={contextLabel} />
            </div>
          </header>
          <main className={`main${messaging ? ' main-messaging' : ''}`}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
      {mobileItems && mobileItems.length > 0 && (
        <nav className="bottom-nav" aria-label="Primary">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'on' : undefined)}
            >
              <i className={`ti ${item.icon}`} />
              {item.label}
            </NavLink>
          ))}
          <button type="button" onClick={() => setNavOpen(true)}>
            <i className="ti ti-dots" />
            More
          </button>
        </nav>
      )}
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
      <img src="/lvd-logo.png" alt="Las Vegas Designs USA" />
      <div>
        <div className="bt">Las Vegas Designs</div>
        <div className="bs">{subtitle}</div>
      </div>
    </div>
  );
}

export function LogoutLink({ onClick }: { onClick: () => void }) {
  return (
    <a
      className="logout-link"
      href="#logout"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <i className="ti ti-logout" /> Logout
    </a>
  );
}
