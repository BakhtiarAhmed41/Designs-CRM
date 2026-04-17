"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../../lib/api";
import { getMe, type User } from "../../../../lib/auth";
import { adminListOrders, type AdminOrder, type OrderStatus } from "../../../../lib/orders";

function formatDate(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

const STATUSES: Array<{ value: "" | OrderStatus; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "CREATED", label: "CREATED (new)" },
  { value: "IN_PROGRESS", label: "IN_PROGRESS" },
  { value: "COMPLETED", label: "COMPLETED" },
  { value: "REJECTED", label: "REJECTED" },
  { value: "CLOSED", label: "CLOSED" },
];

export default function AdminOrdersPage() {
  const [me, setMe] = useState<User | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState<"" | OrderStatus>("");
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canLoad = me?.role === "ADMIN";
  const filters = useMemo(() => ({ status: status || undefined, clientId: clientId.trim() || undefined }), [status, clientId]);

  useEffect(() => {
    getMe()
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminListOrders(filters)
      .then((r) => {
        if (!cancelled) setOrders(r.orders);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load orders");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoad, filters]);

  if (me && me.role !== "ADMIN") {
    return (
      <div className="rounded-lg border bg-white p-5">
        <div className="font-medium text-zinc-900">Admin only</div>
        <div className="text-sm text-zinc-600 mt-1">You don’t have permission to view this page.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin · Orders</h1>
        <p className="text-sm text-zinc-600">Review new orders, approve/reject, and deliver files.</p>
      </div>

      <div className="rounded-lg border bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Status</label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm bg-white"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-sm font-medium">Client ID (optional)</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Filter orders for a specific client UUID"
            />
          </div>
        </div>
      </div>

      {loading ? <div className="text-sm text-zinc-500">Loading…</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-zinc-600 bg-zinc-50">
          <div className="col-span-4">Client</div>
          <div className="col-span-4">Service</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Created</div>
        </div>
        {orders.length === 0 && !loading ? (
          <div className="px-4 py-6 text-sm text-zinc-600">No matching orders.</div>
        ) : (
          <div className="divide-y">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="grid grid-cols-12 gap-3 px-4 py-3 text-sm hover:bg-zinc-50"
              >
                <div className="col-span-4 truncate text-zinc-700">{o.client?.email ?? o.clientId}</div>
                <div className="col-span-4 font-medium text-zinc-900">{o.serviceType}</div>
                <div className="col-span-2 text-zinc-700">{o.status}</div>
                <div className="col-span-2 text-zinc-600">{formatDate(o.createdAt)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

