"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api";
import { getMe, type User } from "../../../lib/auth";

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((r) => {
        if (!cancelled) setUser(r.user);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        // Ignore other errors here; the dashboard can render without the badge.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="crm-page-title">Dashboard</h1>
        <p className="crm-page-desc">Overview of your account and quick links.</p>
      </div>

      <div className="crm-surface p-6 sm:p-7">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Signed in as</div>
        <div className="mt-1 text-lg font-medium tracking-tight text-zinc-900">{user?.email}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-600">Role</span>
          <span className="crm-badge">{user?.role ?? "…"}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/orders" className="crm-surface group block p-5 transition hover:border-emerald-600/25">
          <div className="text-sm font-semibold text-zinc-900 group-hover:text-emerald-700">Orders</div>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">Create and track your design requests.</p>
        </Link>
        <Link href="/profile" className="crm-surface group block p-5 transition hover:border-emerald-600/25">
          <div className="text-sm font-semibold text-zinc-900 group-hover:text-emerald-700">Profile</div>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">Update your name and contact details.</p>
        </Link>
      </div>
    </div>
  );
}
