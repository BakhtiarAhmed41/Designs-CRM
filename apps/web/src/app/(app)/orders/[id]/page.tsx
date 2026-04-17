"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError } from "../../../../lib/api";
import {
  downloadSignedFile,
  getMyAttachmentSignedUrl,
  getMyDeliveryFileSignedUrl,
  getMyOrder,
  type Order,
} from "../../../../lib/orders";

function formatDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function formatBytes(n: number | null) {
  if (typeof n !== "number") return "";
  const kb = 1024;
  const mb = kb * 1024;
  if (n >= mb) return `${(n / mb).toFixed(1)} MB`;
  if (n >= kb) return `${(n / kb).toFixed(1)} KB`;
  return `${n} B`;
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const latestDelivery = useMemo(() => order?.deliveries?.[0] ?? null, [order]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMyOrder(orderId)
      .then((r) => {
        if (!cancelled) setOrder(r.order);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load order");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Order</h1>
        <p className="text-sm text-zinc-600">{order ? `Status: ${order.status}` : "Loading…"}</p>
      </div>

      {loading ? <div className="text-sm text-zinc-500">Loading…</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {order ? (
        <>
          <div className="rounded-lg border bg-white p-5 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-zinc-500">Service type</div>
                <div className="font-medium text-zinc-900">{order.serviceType}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Created</div>
                <div className="text-sm text-zinc-800">{formatDate(order.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Approved</div>
                <div className="text-sm text-zinc-800">{formatDate(order.approvedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Completed</div>
                <div className="text-sm text-zinc-800">{formatDate(order.completedAt)}</div>
              </div>
            </div>

            {order.size ? (
              <div>
                <div className="text-xs text-zinc-500">Size / format</div>
                <div className="text-sm text-zinc-800">{order.size}</div>
              </div>
            ) : null}

            {order.instructions ? (
              <div>
                <div className="text-xs text-zinc-500">Instructions</div>
                <div className="text-sm text-zinc-800 whitespace-pre-wrap">{order.instructions}</div>
              </div>
            ) : null}

            {order.rejectionReason ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Rejected: {order.rejectionReason}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Attachments</h2>
              <div className="text-xs text-zinc-500">{order.attachments.length} file(s)</div>
            </div>
            <div className="mt-3 divide-y">
              {order.attachments.length === 0 ? (
                <div className="py-3 text-sm text-zinc-600">No attachments uploaded.</div>
              ) : (
                order.attachments.map((a) => (
                  <div key={a.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-900">{a.originalName}</div>
                      <div className="text-xs text-zinc-500">{formatBytes(a.byteSize)}</div>
                    </div>
                    <button
                      className="rounded-md border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
                      disabled={downloading === a.id}
                      onClick={async () => {
                        setDownloading(a.id);
                        try {
                          const r = await getMyAttachmentSignedUrl(order.id, a.id);
                          await downloadSignedFile(r.url, a.originalName);
                        } catch (e) {
                          setError(e instanceof ApiError ? e.message : "Download failed");
                        } finally {
                          setDownloading(null);
                        }
                      }}
                    >
                      {downloading === a.id ? "Preparing…" : "Download"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Deliveries</h2>
              {latestDelivery ? (
                <div className="text-xs text-zinc-500">Latest: v{latestDelivery.version}</div>
              ) : (
                <div className="text-xs text-zinc-500">None yet</div>
              )}
            </div>

            <div className="mt-3 space-y-4">
              {order.deliveries.length === 0 ? (
                <div className="text-sm text-zinc-600">No deliveries uploaded yet.</div>
              ) : (
                order.deliveries.map((d) => (
                  <div key={d.id} className="rounded-md border p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-zinc-900">Delivery v{d.version}</div>
                      <div className="text-xs text-zinc-500">{formatDate(d.createdAt)}</div>
                    </div>
                    <div className="mt-3 divide-y">
                      {d.files.map((f) => (
                        <div key={f.id} className="py-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-zinc-900">{f.originalName}</div>
                            <div className="text-xs text-zinc-500">{formatBytes(f.byteSize)}</div>
                          </div>
                          <button
                            className="rounded-md border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
                            disabled={downloading === f.id}
                            onClick={async () => {
                              setDownloading(f.id);
                              try {
                                const r = await getMyDeliveryFileSignedUrl(order.id, f.id);
                                await downloadSignedFile(r.url, f.originalName);
                              } catch (e) {
                                setError(e instanceof ApiError ? e.message : "Download failed");
                              } finally {
                                setDownloading(null);
                              }
                            }}
                          >
                            {downloading === f.id ? "Preparing…" : "Download"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

