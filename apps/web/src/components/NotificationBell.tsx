import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/notifications';
import { STAFF_ROLES } from '@/lib/types';
import { whenVisible } from '@/lib/queryRefresh';
import { IconBell } from './Icon';

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function iconFor(title: string) {
  const t = title.toLowerCase();
  if (t.includes('message') || t.includes('replied')) return { cls: 'msg', icon: 'ti-message' };
  if (t.includes('quote')) return { cls: 'quote', icon: 'ti-file-invoice' };
  if (t.includes('file') || t.includes('deliver')) return { cls: 'file', icon: 'ti-download' };
  if (t.includes('pay') || t.includes('invoice')) return { cls: 'pay', icon: 'ti-cash' };
  return { cls: 'msg', icon: 'ti-bell' };
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isStaff = !!user && STAFF_ROLES.includes(user.role);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    refetchInterval: whenVisible(30_000),
  });

  const unread = data?.unreadCount ?? 0;
  const items = data?.notifications ?? [];

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function onMarkAll() {
    await markAllNotificationsRead();
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function onItem(id: string, link: string | null) {
    await markNotificationRead(id);
    qc.invalidateQueries({ queryKey: ['notifications'] });
    setOpen(false);
    if (!link) return;
    let target = link;
    if (target.startsWith('/orders/')) {
      target = isStaff ? `/admin${target}` : `/portal${target}`;
    } else if (target.startsWith('/quotes/')) {
      target = isStaff ? `/admin${target}` : `/portal${target}`;
    } else if (
      !target.startsWith('/portal') &&
      !target.startsWith('/admin') &&
      !target.startsWith('/pay') &&
      !target.startsWith('/login')
    ) {
      target = isStaff
        ? target.startsWith('/')
          ? `/admin${target}`
          : `/admin/${target}`
        : target.startsWith('/')
          ? `/portal${target}`
          : `/portal/${target}`;
    }
    // Role mismatch: staff shouldn't open portal-only shells and vice versa.
    if (isStaff && target.startsWith('/portal/')) {
      target = target.replace(/^\/portal/, '/admin');
      if (target.startsWith('/admin/quotes/') === false && target.includes('/quotes/')) {
        /* ok */
      }
    }
    if (!isStaff && target.startsWith('/admin/')) {
      target = target.replace(/^\/admin/, '/portal');
    }
    navigate(target);
  }

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <div
        className="bell"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        aria-label="Notifications"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v);
        }}
      >
        <IconBell size={19} />
        {unread > 0 && <span className="nb">{unread}</span>}
      </div>
      {open && (
        <div className={`notif-drop${open ? ' open' : ''}`}>
          <div className="nh">
            Notifications{' '}
            <a
              onClick={(e) => {
                e.preventDefault();
                void onMarkAll();
              }}
            >
              Mark all read
            </a>
          </div>
          <div className="notif-list">
            {items.length === 0 && (
              <div className="nitem">
                <div>
                  <div className="ntx" style={{ color: 'var(--muted)' }}>
                    You're all caught up.
                  </div>
                </div>
              </div>
            )}
            {items.map((n) => {
              const ic = iconFor(n.title);
              return (
                <div
                  key={n.id}
                  className={`nitem${n.readAt ? '' : ' unread'}`}
                  onClick={() => void onItem(n.id, n.link)}
                >
                  <div className={`nic ${ic.cls}`}>
                    <i className={`ti ${ic.icon}`} />
                  </div>
                  <div>
                    <div className="ntx">
                      <b>{n.title}</b>
                      {n.body ? `: ${n.body}` : ''}
                    </div>
                    <div className="ntm">{relativeTime(n.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
