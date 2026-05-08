"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMe, logout, type UserRole } from "../lib/auth";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type Notification } from "../lib/notifications";

function Icon({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className ?? "size-5"}
    >
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavLink({
  href,
  label,
  iconPath,
  onClick,
}: {
  href: string;
  label: string;
  iconPath: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(`${href}/`);

  const className = active
    ? "flex items-center gap-3 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm"
    : "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900";

  const content = (
    <>
      <Icon
        path={iconPath}
        className={active ? "size-5 text-white" : "size-5 text-zinc-500"}
      />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  useEffect(() => {
    getMe()
      .then((r) => setRole(r.user.role))
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
      if (e.key === "Escape") setNotifOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function refreshNotifications() {
    setLoadingNotifs(true);
    try {
      const r = await listNotifications();
      setNotifications(r.notifications);
      setUnreadCount(r.unreadCount);
    } finally {
      setLoadingNotifs(false);
    }
  }

  useEffect(() => {
    refreshNotifications().catch(() => {});
    const t = window.setInterval(() => {
      refreshNotifications().catch(() => {});
    }, 30000);
    return () => window.clearInterval(t);
  }, []);

  const links: Array<{ href: string; label: string; iconPath: string; adminOnly?: boolean }> = [
    {
      href: "/dashboard",
      label: "Dashboard",
      iconPath:
        "M4 10.5c0-.6.25-1.18.7-1.59l5.6-5.09a2.4 2.4 0 0 1 3.4 0l5.6 5.09c.45.41.7.99.7 1.59V20a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 20v-9.5Z",
    },
    {
      href: "/orders",
      label: "Orders",
      iconPath: "M7 7h10M7 12h10M7 17h6M6.2 3.8h11.6A2.4 2.4 0 0 1 20.2 6.2v11.6a2.4 2.4 0 0 1-2.4 2.4H6.2a2.4 2.4 0 0 1-2.4-2.4V6.2a2.4 2.4 0 0 1 2.4-2.4Z",
    },
    {
      href: "/quotations",
      label: "Quotations",
      iconPath:
        "M4.5 7.2A2.7 2.7 0 0 1 7.2 4.5h9.6a2.7 2.7 0 0 1 2.7 2.7v9.6a2.7 2.7 0 0 1-2.7 2.7H7.2a2.7 2.7 0 0 1-2.7-2.7V7.2Z M8 9h8M8 12h6M8 15h4",
    },
    {
      href: "/admin/orders",
      label: "Admin",
      adminOnly: true,
      iconPath:
        "M12 3.8 19.2 7v6.2c0 4.3-3.1 8.1-7.2 9-4.1-.9-7.2-4.7-7.2-9V7L12 3.8Z",
    },
    {
      href: "/payments",
      label: "Payments",
      iconPath: "M4 8.5h16M6.5 15.5h3.5M4 7.2A2.7 2.7 0 0 1 6.7 4.5h10.6A2.7 2.7 0 0 1 20 7.2v9.6a2.7 2.7 0 0 1-2.7 2.7H6.7A2.7 2.7 0 0 1 4 16.8V7.2Z",
    },
    {
      href: "/support",
      label: "Customer Support",
      iconPath:
        "M7 19.5c-.8 0-1.5-.7-1.5-1.5V12a6.5 6.5 0 1 1 13 0v6c0 .8-.7 1.5-1.5 1.5h-1.5l-2.5 2.5v-2.5H7Z",
    },
    {
      href: "/profile",
      label: "Settings",
      iconPath:
        "M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm-7.2 8.6c1.6-3.8 5-5.7 7.2-5.7s5.6 1.9 7.2 5.7",
    },
  ];

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  const Sidebar = ({ onNavigate }: { onNavigate?: () => void }) => (
    <aside className="flex h-full w-[260px] flex-col border-r border-zinc-200/80 bg-white">
      <div className="flex items-center gap-3 px-5 py-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-3 font-semibold tracking-tight text-zinc-900"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-zinc-900 text-sm font-bold text-white">
            D
          </span>
          <span className="leading-tight">
            <span className="block text-sm">Designs</span>
            <span className="block text-xs font-medium text-zinc-500">CRM</span>
          </span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {links
          .filter((l) => !l.adminOnly || role === "ADMIN")
          .map((l) => (
            <NavLink
              key={l.href}
              href={l.href}
              label={l.label}
              iconPath={l.iconPath}
              onClick={
                onNavigate
                  ? () => {
                      onNavigate();
                      router.push(l.href);
                    }
                  : undefined
              }
            />
          ))}
      </nav>

      <div className="border-t border-zinc-100 p-3">
        <NavLink
          href="#logout"
          label="Logout"
          iconPath="M10 16.5H6.6A2.6 2.6 0 0 1 4 13.9V6.6A2.6 2.6 0 0 1 6.6 4H10M14 16.5 18 12l-4-4.5M18 12H10"
          onClick={async () => {
            onNavigate?.();
            await onLogout();
          }}
        />
      </div>
    </aside>
  );

  return (
    <div className="min-h-dvh">
      <div className="flex min-h-dvh">
        <div className="sticky top-0 hidden h-dvh shrink-0 md:block">
          <Sidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/85 backdrop-blur-md">
            <div className="flex items-center gap-3 px-4 py-3 md:px-6">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-zinc-700 shadow-sm hover:bg-zinc-50 md:hidden"
                aria-label="Open menu"
                onClick={() => setSidebarOpen(true)}
              >
                <Icon
                  path="M4 7h16M4 12h16M4 17h16"
                  className="size-5"
                />
              </button>

              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-zinc-900">Designs CRM</div>
                <div className="text-xs font-medium text-zinc-500">Workspace</div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <div className="relative hidden md:block">
                  <button
                    type="button"
                    className="relative inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-zinc-700 shadow-sm hover:bg-zinc-50"
                    aria-label="Notifications"
                    onClick={async () => {
                      const next = !notifOpen;
                      setNotifOpen(next);
                      if (next) await refreshNotifications().catch(() => {});
                    }}
                  >
                    <Icon
                      path="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm6.2-6.5V11a6.2 6.2 0 1 0-12.4 0v4.5l-1.6 1.6V18h15.6v-.9l-1.2-1.6Z"
                      className="size-5"
                    />
                    {unreadCount > 0 ? (
                      <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    ) : null}
                  </button>

                  {notifOpen ? (
                    <div className="absolute right-0 top-12 z-30 w-[380px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
                      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                        <div className="text-sm font-semibold text-zinc-900">Notifications</div>
                        <button
                          type="button"
                          className="text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                          onClick={async () => {
                            await markAllNotificationsRead();
                            await refreshNotifications().catch(() => {});
                          }}
                        >
                          Mark all as read
                        </button>
                      </div>

                      <div className="max-h-[420px] overflow-auto">
                        {loadingNotifs ? (
                          <div className="px-4 py-6 text-sm text-zinc-500">Loading…</div>
                        ) : notifications.length === 0 ? (
                          <div className="px-4 py-6 text-sm text-zinc-500">No notifications yet.</div>
                        ) : (
                          <div className="divide-y divide-zinc-100">
                            {notifications.map((n) => {
                              const unread = !n.readAt;
                              return (
                                <div key={n.id} className="px-4 py-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <button
                                      type="button"
                                      className="min-w-0 text-left"
                                      onClick={async () => {
                                        if (unread) await markNotificationRead(n.id);
                                        setNotifOpen(false);
                                        await refreshNotifications().catch(() => {});
                                        if (n.link) router.push(n.link);
                                      }}
                                    >
                                      <div className={unread ? "text-sm font-semibold text-zinc-900" : "text-sm font-medium text-zinc-700"}>
                                        {n.title}
                                      </div>
                                      {n.body ? (
                                        <div className={unread ? "mt-0.5 text-sm text-zinc-700" : "mt-0.5 text-sm text-zinc-500"}>
                                          {n.body}
                                        </div>
                                      ) : null}
                                      <div className="mt-1 text-xs text-zinc-400">
                                        {new Date(n.createdAt).toLocaleString()}
                                      </div>
                                    </button>

                                    {unread ? (
                                      <button
                                        type="button"
                                        className="shrink-0 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                                        onClick={async () => {
                                          await markNotificationRead(n.id);
                                          await refreshNotifications().catch(() => {});
                                        }}
                                      >
                                        Mark as read
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="crm-btn-secondary hidden px-3 py-1.5 text-sm md:inline-flex"
                  onClick={onLogout}
                >
                  Logout
                </button>
              </div>
            </div>
          </header>

          <main className="w-full flex-1 px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-zinc-950/30 backdrop-blur-[1px]"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
