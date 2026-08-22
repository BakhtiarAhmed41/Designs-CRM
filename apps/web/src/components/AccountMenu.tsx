import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

function roleTone(label: string) {
  const t = label.toLowerCase();
  if (t.includes('super')) return 'tone-owner';
  if (t.includes('admin')) return 'tone-admin';
  if (t.includes('support')) return 'tone-support';
  if (t.includes('designer')) return 'tone-design';
  if (t.includes('net')) return 'tone-net';
  return 'tone-cust';
}

export function AccountMenu({ contextLabel }: { contextLabel?: string }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initials =
    (user?.firstName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase() +
    (user?.lastName?.[0] ?? '').toUpperCase();
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'User';
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isCustomer = user?.role === 'CLIENT';
  const profilePath = isCustomer ? '/portal/profile' : '/admin/profile';

  const roleLabel =
    contextLabel ||
    (isCustomer ? 'Customer' : String(user?.role ?? '').replace(/_/g, ' '));

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="acct-menu" ref={wrapRef}>
      <button
        type="button"
        className={`acct-trigger${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`acct-av ${roleTone(roleLabel)}`}>{initials}</span>
        <span className="acct-meta">
          <span className="acct-name">{name}</span>
          <span className="acct-role">{roleLabel}</span>
        </span>
        <i className={`ti ti-chevron-down acct-caret${open ? ' up' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="acct-drop" role="menu">
          <div className="acct-drop-head">
            <span className={`acct-av lg ${roleTone(roleLabel)}`}>{initials}</span>
            <div>
              <div className="acct-drop-name">{name}</div>
              {user?.email && <div className="acct-drop-mail">{user.email}</div>}
              <div className="acct-drop-role">{roleLabel}</div>
            </div>
          </div>
          {user && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate(profilePath);
              }}
            >
              <i className="ti ti-user" /> Profile
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              void logout().then(() => navigate('/login', { replace: true }));
            }}
          >
            <i className="ti ti-logout" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
