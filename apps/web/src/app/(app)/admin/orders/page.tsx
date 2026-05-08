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
  { value: "WAITING_FOR_QUOTATION", label: "WAITING_FOR_QUOTATION" },
  { value: "QUOTATION_PROVIDED", label: "QUOTATION_PROVIDED" },
  { value: "WAITING_FOR_ADMIN_QUOTATION_APPROVAL", label: "COUNTER_QUOTATION_SUBMITTED" },
  { value: "CLIENT_REJECTED_QUOTATION", label: "QUOTATION_REJECTED" },
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
      <div className="crm-surface p-6">
        <div className="font-semibold text-zinc-900">Admin only</div>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600">You don’t have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="crm-page-title">Admin · Orders</h1>
        <p className="crm-page-desc">Review new orders, approve or reject, and upload deliverables.</p>
      </div>

      <div className="crm-surface p-6 sm:p-7">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <label className="crm-label" htmlFor="filter-status">
              Status
            </label>
            <select
              id="filter-status"
              className="crm-field"
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | OrderStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="crm-label" htmlFor="filter-client">
              Client ID (optional)
            </label>
            <input
              id="filter-client"
              className="crm-field"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Filter by client UUID"
            />
          </div>
        </div>
      </div>

      {loading ? <div className="text-sm font-medium text-zinc-500">Loading…</div> : null}
      {error ? <div className="crm-alert-error">{error}</div> : null}

      <div className="crm-surface overflow-hidden">
        <div className="crm-surface-header grid grid-cols-[minmax(12rem,2fr)_minmax(12rem,2fr)_minmax(10rem,1fr)_minmax(9rem,auto)] gap-3">
          <div>Client</div>
          <div>Service</div>
          <div>Status</div>
          <div>Created</div>
        </div>
        {orders.length === 0 && !loading ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">No matching orders.</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="grid grid-cols-[minmax(12rem,2fr)_minmax(12rem,2fr)_minmax(10rem,1fr)_minmax(9rem,auto)] gap-3 px-4 py-3.5 text-sm transition-colors hover:bg-zinc-50/80"
              >
                <div className="min-w-0 break-words text-zinc-700">{o.client?.email ?? o.clientId}</div>
                <div className="min-w-0 break-words font-medium text-zinc-900">{o.serviceType}</div>
                <div className="min-w-0">
                  <span className="crm-badge whitespace-normal break-words">{o.status}</span>
                </div>
                <div className="min-w-0 whitespace-normal break-words text-zinc-600">{formatDate(o.createdAt)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
