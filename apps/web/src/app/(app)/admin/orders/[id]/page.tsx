"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "../../../../../lib/api";
import { getMe, type User } from "../../../../../lib/auth";
import {
  adminApproveCounter,
  adminDeliverOrder,
  adminGetAttachmentSignedUrl,
  adminGetDeliveryFileSignedUrl,
  adminGetOrder,
  adminProposeQuotation,
  adminRejectCounter,
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
  const [quoteAmount, setQuoteAmount] = useState<string>("");
  const [quoteCurrency, setQuoteCurrency] = useState<string>("USD");
  const [quoteComment, setQuoteComment] = useState<string>("");
  const [quoteSuccess, setQuoteSuccess] = useState<string | null>(null);
  const [counterDecisionComment, setCounterDecisionComment] = useState<string>("");

  const canLoad = me?.role === "ADMIN";
  const latestDelivery = useMemo(() => order?.deliveries?.[0] ?? null, [order]);
  const latestQuotation = useMemo(() => order?.quotations?.[0] ?? null, [order]);

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
      <div className="crm-surface p-6">
        <div className="font-semibold text-zinc-900">Admin only</div>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600">You don’t have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="crm-page-title">Admin · Order</h1>
          <p className="crm-page-desc flex flex-wrap items-center gap-2">
            {order ? (
              <>
                <span className="crm-badge">{order.status}</span>
                <span className="text-zinc-500">·</span>
                <span>{order.serviceType}</span>
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <button type="button" className="crm-btn-secondary shrink-0 self-start" onClick={() => router.back()}>
          Back
        </button>
      </div>

      {loading ? <div className="text-sm font-medium text-zinc-500">Loading…</div> : null}
      {error ? <div className="crm-alert-error">{error}</div> : null}

      {order ? (
        <>
          {order.status === "WAITING_FOR_QUOTATION" || order.status === "WAITING_FOR_ADMIN_QUOTATION_APPROVAL" ? (
            <div className="crm-surface space-y-4 p-6 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-zinc-900">Send quotation</div>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                    The client is waiting. Send a quotation amount and optional message.
                  </p>
                </div>
                {latestQuotation ? (
                  <div className="text-xs font-medium text-zinc-500">
                    Latest quote: v{latestQuotation.version} · {latestQuotation.status}
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div>
                  <label className="crm-label" htmlFor="quoteAmount">
                    Amount
                  </label>
                  <input
                    id="quoteAmount"
                    className="crm-field"
                    inputMode="decimal"
                    placeholder="e.g. 49.99"
                    value={quoteAmount}
                    onChange={(e) => setQuoteAmount(e.target.value)}
                    disabled={busy}
                  />
                  <div className="mt-1 text-xs text-zinc-500">Stored as cents in the database.</div>
                </div>
                <div>
                  <label className="crm-label" htmlFor="quoteCurrency">
                    Currency
                  </label>
                  <select
                    id="quoteCurrency"
                    className="crm-field"
                    value={quoteCurrency}
                    onChange={(e) => setQuoteCurrency(e.target.value)}
                    disabled={busy}
                  >
                    <option value="USD">USD</option>
                    <option value="PKR">PKR</option>
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div className="sm:col-span-1">
                  <label className="crm-label" htmlFor="quoteComment">
                    Message (optional)
                  </label>
                  <input
                    id="quoteComment"
                    className="crm-field"
                    placeholder="Short message for the client"
                    value={quoteComment}
                    onChange={(e) => setQuoteComment(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>

              {quoteSuccess ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  {quoteSuccess}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="crm-btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    setQuoteSuccess(null);
                    try {
                      const amount = quoteAmount.trim();
                      const parsed = amount ? Number(amount) : NaN;
                      const amountCents = amount ? Math.round(parsed * 100) : null;
                      if (amount && (!Number.isFinite(parsed) || amountCents === null || amountCents <= 0)) {
                        throw new ApiError(400, "Enter a valid quotation amount.");
                      }
                      await adminProposeQuotation(order.id, {
                        amountCents,
                        currency: quoteCurrency,
                        comment: quoteComment.trim() ? quoteComment.trim() : null,
                      });
                      setQuoteSuccess("Quotation sent.");
                      setQuoteAmount("");
                      setQuoteComment("");
                      await refreshOrder();
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : "Failed to send quotation");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Sending…" : "Send quotation"}
                </button>
                <button
                  type="button"
                  className="crm-btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setQuoteAmount("");
                    setQuoteComment("");
                    setQuoteSuccess(null);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          {order.status === "WAITING_FOR_ADMIN_QUOTATION_APPROVAL" && latestQuotation?.status === "COUNTERED" ? (
            <div className="crm-surface space-y-4 p-6 sm:p-7">
              <div className="text-base font-semibold text-zinc-900">Counter quotation decision</div>
              <p className="text-sm leading-relaxed text-zinc-600">
                The client sent a counter quotation (v{latestQuotation.version}). Approve to start the order, or reject it with an optional
                note.
              </p>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="crm-label" htmlFor="counterComment">
                    Comment (optional)
                  </label>
                  <input
                    id="counterComment"
                    className="crm-field"
                    value={counterDecisionComment}
                    onChange={(e) => setCounterDecisionComment(e.target.value)}
                    disabled={busy}
                    placeholder="Reason / next steps"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="crm-btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await adminApproveCounter(order.id);
                      await refreshOrder();
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : "Failed to approve counter quotation");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Working…" : "Approve counter (start order)"}
                </button>
                <button
                  type="button"
                  className="crm-btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await adminRejectCounter(order.id, counterDecisionComment.trim() ? counterDecisionComment.trim() : null);
                      await refreshOrder();
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : "Failed to reject counter quotation");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Working…" : "Reject counter"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="crm-surface space-y-5 p-6 sm:p-7">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Client</div>
                <div className="mt-1 text-sm font-medium text-zinc-900">{order.client?.email ?? order.clientId}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Service type</div>
                <div className="mt-1 text-sm font-medium text-zinc-900">{order.serviceType}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Created</div>
                <div className="mt-1 text-sm text-zinc-800">{formatDate(order.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Latest delivery</div>
                <div className="mt-1 text-sm text-zinc-800">{latestDelivery ? `v${latestDelivery.version}` : "—"}</div>
              </div>
            </div>

            {order.instructions ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Instructions</div>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">{order.instructions}</div>
              </div>
            ) : null}

            {order.rejectionReason ? (
              <div className="crm-alert-error">
                <span className="font-medium">Rejected:</span> {order.rejectionReason}
              </div>
            ) : null}
          </div>

          {order.status === "IN_PROGRESS" ? (
            <div className="crm-surface space-y-4 p-6 sm:p-7">
              <div className="text-base font-semibold text-zinc-900">Deliver</div>
              <p className="text-sm leading-relaxed text-zinc-600">
                Upload deliverables. This creates a new delivery version and marks the order completed.
              </p>
              <input
                className="crm-field cursor-pointer py-2 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-200"
                type="file"
                multiple
                onChange={(e) => setDeliveryFiles(Array.from(e.target.files ?? []))}
              />
              <button
                type="button"
                className="crm-btn-primary"
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

          <div className="crm-surface p-6 sm:p-7">
            <h2 className="text-base font-semibold text-zinc-900">Client attachments</h2>
            <div className="mt-4 divide-y divide-zinc-100">
              {order.attachments.length === 0 ? (
                <div className="py-4 text-sm text-zinc-600">No attachments.</div>
              ) : (
                order.attachments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-900">{a.originalName}</div>
                      <div className="text-xs text-zinc-500">{formatBytes(a.byteSize)}</div>
                    </div>
                    <button
                      type="button"
                      className="crm-btn-secondary shrink-0 px-3 py-1.5 text-sm"
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

          <div className="crm-surface p-6 sm:p-7">
            <h2 className="text-base font-semibold text-zinc-900">Deliveries</h2>
            <div className="mt-4 space-y-4">
              {order.deliveries.length === 0 ? (
                <div className="text-sm text-zinc-600">No deliveries yet.</div>
              ) : (
                order.deliveries.map((d) => (
                  <div key={d.id} className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-900">Delivery v{d.version}</div>
                      <div className="text-xs text-zinc-500">{formatDate(d.createdAt)}</div>
                    </div>
                    <div className="mt-3 divide-y divide-zinc-200/80">
                      {d.files.map((f) => (
                        <div key={f.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-zinc-900">{f.originalName}</div>
                            <div className="text-xs text-zinc-500">{formatBytes(f.byteSize)}</div>
                          </div>
                          <button
                            type="button"
                            className="crm-btn-secondary shrink-0 px-3 py-1.5 text-sm"
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
