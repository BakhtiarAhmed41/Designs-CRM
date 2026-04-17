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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-zinc-600">Create a new order and track its status.</p>
        </div>
        <Link
          href="/orders/new"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          New order
        </Link>
      </div>

      {loading ? <div className="text-sm text-zinc-500">Loading…</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-zinc-600 bg-zinc-50">
          <div className="col-span-5">Service</div>
          <div className="col-span-3">Status</div>
          <div className="col-span-4">Created</div>
        </div>
        {orders.length === 0 && !loading ? (
          <div className="px-4 py-6 text-sm text-zinc-600">No orders yet.</div>
        ) : (
          <div className="divide-y">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="grid grid-cols-12 gap-3 px-4 py-3 text-sm hover:bg-zinc-50"
              >
                <div className="col-span-5 font-medium text-zinc-900">{o.serviceType}</div>
                <div className="col-span-3 text-zinc-700">{o.status}</div>
                <div className="col-span-4 text-zinc-600">{formatDate(o.createdAt)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

