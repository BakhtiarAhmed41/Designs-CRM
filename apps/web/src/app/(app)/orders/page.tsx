"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api";
import { listMyOrders, type Order } from "../../../lib/orders";

function formatDate(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMyOrders()
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
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="crm-page-title">Orders</h1>
          <p className="crm-page-desc">Create a new order and track its status.</p>
        </div>
        <Link href="/orders/new" className="crm-btn-primary shrink-0 self-start sm:self-center">
          New order
        </Link>
      </div>

      {loading ? <div className="text-sm font-medium text-zinc-500">Loading…</div> : null}
      {error ? <div className="crm-alert-error">{error}</div> : null}

      <div className="crm-surface overflow-hidden">
        <div className="crm-surface-header grid grid-cols-[minmax(10rem,1.5fr)_minmax(12rem,2fr)_minmax(10rem,1fr)_minmax(9rem,auto)] gap-3">
          <div>Category</div>
          <div>Sub category</div>
          <div>Status</div>
          <div>Created</div>
        </div>
        {orders.length === 0 && !loading ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">
            No orders yet. Start with <span className="font-medium text-zinc-900">New order</span>.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="grid grid-cols-[minmax(10rem,1.5fr)_minmax(12rem,2fr)_minmax(10rem,1fr)_minmax(9rem,auto)] gap-3 px-4 py-3.5 text-sm transition-colors hover:bg-zinc-50/80"
              >
                <div className="min-w-0 break-words text-zinc-700">{o.mainCategory ?? "—"}</div>
                <div className="min-w-0 break-words font-medium text-zinc-900">{o.subCategory ?? o.serviceType}</div>
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
