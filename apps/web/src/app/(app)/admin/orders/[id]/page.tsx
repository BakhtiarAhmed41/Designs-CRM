"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "../../../../../lib/api";
import { getMe, type User } from "../../../../../lib/auth";
import {
  adminApproveOrder,
  adminDeliverOrder,
  adminGetAttachmentSignedUrl,
  adminGetDeliveryFileSignedUrl,
  adminGetOrder,
  adminRejectOrder,
  downloadSignedFile,
  type AdminOrder,
} from "../../../../../lib/orders";

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

export default function AdminOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [me, setMe] = useState<User | null>(null);
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [deliveryFiles, setDeliveryFiles] = useState<File[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);

  const canLoad = me?.role === "ADMIN";
  const latestDelivery = useMemo(() => order?.deliveries?.[0] ?? null, [order]);

  async function refreshOrder() {
    const r = await adminGetOrder(orderId);
    setOrder(r.order);
  }

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
    adminGetOrder(orderId)
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
  }, [canLoad, orderId]);

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin · Order</h1>
          <p className="text-sm text-zinc-600">{order ? `Status: ${order.status}` : "Loading…"}</p>
        </div>
        <button className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50" onClick={() => router.back()}>
          Back
        </button>
      </div>

      {loading ? <div className="text-sm text-zinc-500">Loading…</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {order ? (
        <>
          <div className="rounded-lg border bg-white p-5 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-zinc-500">Client</div>
                <div className="text-sm text-zinc-900 font-medium">{order.client?.email ?? order.clientId}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Service type</div>
                <div className="text-sm text-zinc-900 font-medium">{order.serviceType}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Created</div>
                <div className="text-sm text-zinc-800">{formatDate(order.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Latest delivery</div>
                <div className="text-sm text-zinc-800">{latestDelivery ? `v${latestDelivery.version}` : "—"}</div>
              </div>
            </div>

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

          {order.status === "CREATED" ? (
            <div className="rounded-lg border bg-white p-5 space-y-3">
              <div className="font-semibold">Review</div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await adminApproveOrder(order.id);
                      await refreshOrder();
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : "Approve failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Working…" : "Approve"}
                </button>

                <div className="flex-1 min-w-72 flex flex-col gap-2">
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason"
                  />
                  <button
                    className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
                    disabled={busy || !rejectReason.trim()}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await adminRejectOrder(order.id, rejectReason.trim());
                        await refreshOrder();
                      } catch (e) {
                        setError(e instanceof ApiError ? e.message : "Reject failed");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {order.status === "IN_PROGRESS" ? (
            <div className="rounded-lg border bg-white p-5 space-y-3">
              <div className="font-semibold">Deliver</div>
              <div className="text-sm text-zinc-600">Upload deliverables. This will create a new delivery version and mark the order Completed.</div>
              <input
                className="w-full text-sm"
                type="file"
                multiple
                onChange={(e) => setDeliveryFiles(Array.from(e.target.files ?? []))}
              />
              <button
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                disabled={busy || deliveryFiles.length === 0}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await adminDeliverOrder(order.id, deliveryFiles);
                    setDeliveryFiles([]);
                    await refreshOrder();
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : "Delivery failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Uploading…" : "Upload delivery + mark completed"}
              </button>
            </div>
          ) : null}

          <div className="rounded-lg border bg-white p-5">
            <h2 className="text-base font-semibold">Client attachments</h2>
            <div className="mt-3 divide-y">
              {order.attachments.length === 0 ? (
                <div className="py-3 text-sm text-zinc-600">No attachments.</div>
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
                          const r = await adminGetAttachmentSignedUrl(order.id, a.id);
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
            <h2 className="text-base font-semibold">Deliveries</h2>
            <div className="mt-3 space-y-4">
              {order.deliveries.length === 0 ? (
                <div className="text-sm text-zinc-600">No deliveries yet.</div>
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
                                const r = await adminGetDeliveryFileSignedUrl(order.id, f.id);
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

