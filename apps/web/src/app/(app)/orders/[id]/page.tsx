"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError } from "../../../../lib/api";
import {
  acceptQuotation,
  counterQuotation,
  downloadSignedFile,
  getMyAttachmentSignedUrl,
  getMyDeliveryFileSignedUrl,
  getMyOrder,
  rejectQuotation,
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
  const [busy, setBusy] = useState(false);
  const [decisionComment, setDecisionComment] = useState("");
  const [counterAmount, setCounterAmount] = useState("");
  const [counterCurrency, setCounterCurrency] = useState("USD");
  const [counterComment, setCounterComment] = useState("");

  const latestDelivery = useMemo(() => order?.deliveries?.[0] ?? null, [order]);
  const latestQuotation = useMemo(() => order?.quotations?.[0] ?? null, [order]);

  async function refresh() {
    const r = await getMyOrder(orderId);
    setOrder(r.order);
  }

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
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="crm-page-title">Order</h1>
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
      </div>

      {loading ? <div className="text-sm font-medium text-zinc-500">Loading…</div> : null}
      {error ? <div className="crm-alert-error">{error}</div> : null}

      {order ? (
        <>
          {order.status === "WAITING_FOR_QUOTATION" ? (
            <div className="crm-surface p-6 sm:p-7">
              <div className="text-base font-semibold text-zinc-900">Waiting for quotation</div>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                Your request has been submitted. An admin will provide a quotation soon.
              </p>
            </div>
          ) : null}

          {order.status === "WAITING_FOR_ADMIN_QUOTATION_APPROVAL" ? (
            <div className="crm-surface p-6 sm:p-7">
              <div className="text-base font-semibold text-zinc-900">Counter quotation submitted</div>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">Waiting for admin approval of your counter quotation.</p>
            </div>
          ) : null}

          {order.status === "CLIENT_REJECTED_QUOTATION" ? (
            <div className="crm-surface p-6 sm:p-7">
              <div className="text-base font-semibold text-zinc-900">Quotation rejected</div>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">This order did not proceed because the quotation was rejected.</p>
            </div>
          ) : null}

          {order.status === "QUOTATION_PROVIDED" && latestQuotation ? (
            <div className="crm-surface space-y-4 p-6 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-zinc-900">Quotation provided</div>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600">Approve, reject, or send a counter quotation.</p>
                </div>
                <div className="text-xs font-medium text-zinc-500">v{latestQuotation.version}</div>
              </div>

              <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                <div className="text-sm font-semibold text-zinc-900">
                  {latestQuotation.amountCents ? (
                    <>
                      {(latestQuotation.amountCents / 100).toFixed(2)} {latestQuotation.currency}
                    </>
                  ) : (
                    "Amount not specified"
                  )}
                </div>
                {latestQuotation.comment ? (
                  <div className="mt-1 text-sm text-zinc-700">{latestQuotation.comment}</div>
                ) : (
                  <div className="mt-1 text-sm text-zinc-500">No message.</div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="crm-label" htmlFor="decisionComment">
                    Comment (optional)
                  </label>
                  <input
                    id="decisionComment"
                    className="crm-field"
                    value={decisionComment}
                    onChange={(e) => setDecisionComment(e.target.value)}
                    disabled={busy}
                    placeholder="Optional note"
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
                      await acceptQuotation(order.id);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : "Failed to approve quotation");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Working…" : "Approve quotation"}
                </button>
                <button
                  type="button"
                  className="crm-btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await rejectQuotation(order.id, decisionComment.trim() ? decisionComment.trim() : null);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : "Failed to reject quotation");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Working…" : "Reject (no counter)"}
                </button>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="text-sm font-semibold text-zinc-900">Counter quotation</div>
                <div className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <div>
                    <label className="crm-label" htmlFor="counterAmount">
                      Amount (optional)
                    </label>
                    <input
                      id="counterAmount"
                      className="crm-field"
                      inputMode="decimal"
                      placeholder="e.g. 39.99"
                      value={counterAmount}
                      onChange={(e) => setCounterAmount(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <label className="crm-label" htmlFor="counterCurrency">
                      Currency
                    </label>
                    <select
                      id="counterCurrency"
                      className="crm-field"
                      value={counterCurrency}
                      onChange={(e) => setCounterCurrency(e.target.value)}
                      disabled={busy}
                    >
                      <option value="USD">USD</option>
                      <option value="PKR">PKR</option>
                      <option value="GBP">GBP</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="crm-label" htmlFor="counterComment">
                      Message (optional)
                    </label>
                    <input
                      id="counterComment"
                      className="crm-field"
                      value={counterComment}
                      onChange={(e) => setCounterComment(e.target.value)}
                      disabled={busy}
                      placeholder="Explain your counter offer"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    className="crm-btn-primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const amount = counterAmount.trim();
                        const parsed = amount ? Number(amount) : NaN;
                        const amountCents = amount ? Math.round(parsed * 100) : null;
                        if (amount && (!Number.isFinite(parsed) || amountCents === null || amountCents <= 0)) {
                          throw new ApiError(400, "Enter a valid counter amount.");
                        }
                        await counterQuotation(order.id, {
                          amountCents,
                          currency: counterCurrency,
                          comment: counterComment.trim() ? counterComment.trim() : null,
                        });
                        setCounterAmount("");
                        setCounterComment("");
                        await refresh();
                      } catch (e) {
                        setError(e instanceof ApiError ? e.message : "Failed to submit counter quotation");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Submitting…" : "Submit counter quotation"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="crm-surface space-y-5 p-6 sm:p-7">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Service type</div>
                <div className="mt-1 font-medium text-zinc-900">{order.serviceType}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Created</div>
                <div className="mt-1 text-sm text-zinc-800">{formatDate(order.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Approved</div>
                <div className="mt-1 text-sm text-zinc-800">{formatDate(order.approvedAt)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Completed</div>
                <div className="mt-1 text-sm text-zinc-800">{formatDate(order.completedAt)}</div>
              </div>
            </div>

            {order.size ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Size / format</div>
                <div className="mt-1 text-sm text-zinc-800">{order.size}</div>
              </div>
            ) : null}

            {order.instructions ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Instructions</div>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">{order.instructions}</div>
              </div>
            ) : null}

            {order.rejectionReason ? (
              <div className="crm-alert-error border-red-200">
                <span className="font-medium">Rejected:</span> {order.rejectionReason}
              </div>
            ) : null}
          </div>

          <div className="crm-surface p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-zinc-900">Attachments</h2>
              <div className="text-xs font-medium text-zinc-500">{order.attachments.length} file(s)</div>
            </div>
            <div className="mt-4 divide-y divide-zinc-100">
              {order.attachments.length === 0 ? (
                <div className="py-4 text-sm text-zinc-600">No attachments uploaded.</div>
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

          <div className="crm-surface p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-zinc-900">Deliveries</h2>
              {latestDelivery ? (
                <div className="text-xs font-medium text-zinc-500">Latest: v{latestDelivery.version}</div>
              ) : (
                <div className="text-xs font-medium text-zinc-500">None yet</div>
              )}
            </div>

            <div className="mt-4 space-y-4">
              {order.deliveries.length === 0 ? (
                <div className="text-sm text-zinc-600">No deliveries uploaded yet.</div>
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
