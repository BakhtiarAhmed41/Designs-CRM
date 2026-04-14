"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout } from "../lib/auth";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <div className="min-h-full flex flex-col bg-zinc-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold">
              Designs CRM
            </Link>
            <nav className="flex items-center gap-3 text-sm text-zinc-600">
              <Link href="/dashboard" className="hover:text-zinc-900">
                Dashboard
              </Link>
              <Link href="/profile" className="hover:text-zinc-900">
                Profile
              </Link>
            </nav>
          </div>
          <button
            className="text-sm rounded-md border px-3 py-1.5 hover:bg-zinc-50"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            Logout
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl w-full flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

