"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api";
import { getMe, type User } from "../../../lib/auth";
import { CATEGORY_TREE, type MainCategory } from "../../../components/CategorySelect";
import { listMyOrders, type Order } from "../../../lib/orders";

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    listMyOrders()
      .then((r) => {
        if (!cancelled) setOrders(r.orders);
      })
      .catch(() => {
        // ignore here, auth guard handles redirects
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalOrders = orders.length;
  const completedOrders = orders.filter((o) => o.status === "COMPLETED").length;
  const inProgressOrders = orders.filter((o) => o.status === "IN_PROGRESS").length;
  const waitingForQuote = orders.filter((o) => o.status === "WAITING_FOR_QUOTATION").length;
  const spentCents = orders.reduce((sum, o) => {
    const approved = (o.quotations ?? []).find((q) => q.status === "APPROVED");
    return sum + (approved?.amountCents ?? 0);
  }, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="crm-page-title">Dashboard</h1>
        <p className="crm-page-desc">Overview of your account and quick links.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="crm-surface p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Total orders</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{totalOrders}</div>
        </div>
        <div className="crm-surface p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Active</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{inProgressOrders}</div>
        </div>
        <div className="crm-surface p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Completed</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{completedOrders}</div>
        </div>
        <div className="crm-surface p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Waiting for quotation</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{waitingForQuote}</div>
        </div>
      </div>

      <div className="crm-surface p-6 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Quick start</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">Create a new order</div>
            <p className="mt-1 text-sm leading-relaxed text-zinc-600">Pick a category to prefill the order form.</p>
          </div>
          <div className="text-sm font-medium text-zinc-700">
            Amount spent (approved quotes):{" "}
            <span className="font-semibold text-zinc-900">${(spentCents / 100).toFixed(2)}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(CATEGORY_TREE) as MainCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              className="crm-surface group flex min-h-24 flex-col justify-between border-zinc-200/90 p-5 text-left transition hover:border-emerald-600/25 hover:bg-white"
              onClick={() => router.push(`/orders/new?category=${encodeURIComponent(c)}`)}
            >
              <div className="text-sm font-semibold text-zinc-900 group-hover:text-emerald-700">{c}</div>
              <div className="mt-2 text-xs text-zinc-500">{CATEGORY_TREE[c].title}</div>
            </button>
          ))}
        </div>
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
