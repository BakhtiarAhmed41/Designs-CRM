"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { getMe, refresh, type User } from "../lib/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await getMe();
        if (!cancelled) setUser(res.user);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          try {
            const r = await refresh();
            if (r.ok) {
              const res = await getMe();
              if (!cancelled) setUser(res.user);
              return;
            }
          } catch {
            // ignore
          }
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        throw e;
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="crm-surface flex items-center gap-3 px-5 py-4">
          <span
            className="inline-block size-4 animate-spin rounded-full border-2 border-zinc-200 border-t-emerald-600"
            aria-hidden
          />
          <span className="text-sm font-medium text-zinc-600">Loading your workspace…</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
