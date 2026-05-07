"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../lib/api";
import { listMyOrders, type Order } from "../../../lib/orders";

function formatDate(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function QuotationsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const quotations = useMemo(
    () => orders.filter((o) => (o.quotations?.length ?? 0) > 0),
    [orders],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMyOrders()
      .then((r) => {
        if (!cancelled) setOrders(r.orders);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load quotations");
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
          <h1 className="crm-page-title">Quotations</h1>
          <p className="crm-page-desc">Request a quotation and track approvals.</p>
        </div>
        <Link href="/quotations/new" className="crm-btn-primary shrink-0 self-start sm:self-center">
          Request quotation
        </Link>
      </div>

      {loading ? <div className="text-sm font-medium text-zinc-500">Loading…</div> : null}
      {error ? <div className="crm-alert-error">{error}</div> : null}

      <div className="crm-surface overflow-hidden">
        <div className="crm-surface-header grid grid-cols-12 gap-3">
          <div className="col-span-3">Category</div>
          <div className="col-span-3">Sub category</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Quotes</div>
          <div className="col-span-2">Created</div>
        </div>
        {quotations.length === 0 && !loading ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">No quotation requests yet.</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {quotations.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="grid grid-cols-12 gap-3 px-4 py-3.5 text-sm transition-colors hover:bg-zinc-50/80"
              >
                <div className="col-span-3 truncate text-zinc-700">{o.mainCategory ?? "—"}</div>
                <div className="col-span-3 font-medium text-zinc-900">{o.subCategory ?? o.serviceType}</div>
                <div className="col-span-2">
                  <span className="crm-badge">{o.status}</span>
                </div>
                <div className="col-span-2 text-zinc-600">{o.quotations?.length ?? 0}</div>
                <div className="col-span-2 text-zinc-600">{formatDate(o.createdAt)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {quotations.length ? (
        <div className="crm-surface p-6 sm:p-7">
          <div className="text-base font-semibold text-zinc-900">Quotation history</div>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">Open an order to approve/reject/counter. History is kept per order.</p>
          <div className="mt-4 space-y-4">
            {quotations.slice(0, 5).map((o) => (
              <div key={o.id} className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-900">
                    {o.subCategory ?? o.serviceType} <span className="text-zinc-500">·</span>{" "}
                    <span className="text-zinc-700">{o.mainCategory ?? "—"}</span>
                  </div>
                  <Link href={`/orders/${o.id}`} className="text-xs font-semibold text-emerald-700 hover:underline">
                    View
                  </Link>
                </div>
                <div className="mt-3 divide-y divide-zinc-200/80">
                  {(o.quotations ?? []).map((q) => (
                    <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                      <div className="text-sm text-zinc-800">
                        v{q.version} · <span className="font-medium">{q.status}</span>{" "}
                        {q.amountCents ? (
                          <span className="text-zinc-600">
                            · {(q.amountCents / 100).toFixed(2)} {q.currency}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-zinc-500">{formatDate(q.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

