import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { confirmPayLink, getPayLinkSummary, startPayLinkCheckout } from '@/lib/billing';
import { getErrorMessage } from '@/lib/api';
import { dateShort, money } from '@/lib/format';
import { ErrorBanner } from '@/components/ui/EmptyState';

export function PayLink() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const returning = params.get('status') === 'success' || params.get('paid') === '1';
  const canceled = params.get('status') === 'canceled' || params.get('canceled') === '1';
  const [error, setError] = useState<string | null>(null);

  const summaryQ = useQuery({
    queryKey: ['pay-link', token],
    queryFn: () => getPayLinkSummary(token),
    enabled: token.length > 0,
    retry: false,
  });

  const confirmMut = useMutation({
    mutationFn: () => confirmPayLink(token),
    onSuccess: () => {
      void summaryQ.refetch();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  useEffect(() => {
    if (!token || !returning) return;
    confirmMut.mutate();
    // confirm once when Stripe sends the customer back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, returning]);

  const payMut = useMutation({
    mutationFn: () => startPayLinkCheckout(token),
    onError: (e) => setError(getErrorMessage(e)),
  });

  const s = confirmMut.data ?? summaryQ.data;
  const alreadyPaid = s?.status === 'PAID';
  const confirming = returning && !alreadyPaid && (confirmMut.isPending || confirmMut.isSuccess);
  const due = s?.dueAt ? dateShort(s.dueAt) : '';
  const paidSoFar = s?.amountPaidCents ?? 0;

  return (
    <div className="center-screen pay-page">
      <div className="pay-card">
        <header className="pay-brand">
          <img src="/lvd-logo-full.png" alt="Las Vegas Designs USA" />
          <p className="pay-kicker">Secure checkout</p>
        </header>

        <div className="pay-body">
          {(summaryQ.isLoading || confirming) && (
            <div className="pay-status">
              <div className="spinner" />
              <p>{confirming ? 'Confirming payment…' : 'Loading invoice…'}</p>
            </div>
          )}

          {summaryQ.isError && !confirming && (
            <div className="pay-status">
              <div className="pay-status-icon">
                <i className="ti ti-link-off" />
              </div>
              <h1>Link unavailable</h1>
              <p>This payment link is invalid or has expired.</p>
            </div>
          )}

          {error && <ErrorBanner>{error}</ErrorBanner>}

          {s && !alreadyPaid && !confirming && (
            <>
              <div className="pay-hero">
                <p className="pay-kicker">{s.status === 'PARTIAL' ? 'Balance due' : 'Amount due'}</p>
                <div className="pay-amount">{money(s.amountCents, s.currency)}</div>
              </div>

              <ul className="pay-rows">
                <li>
                  <span>Billed to</span>
                  <strong>{s.customerName ?? 'Customer'}</strong>
                </li>
                {s.coversText && (
                  <li>
                    <span>For</span>
                    <strong>{s.coversText}</strong>
                  </li>
                )}
                {due && (
                  <li>
                    <span>Due</span>
                    <strong>{due}</strong>
                  </li>
                )}
                {paidSoFar > 0 && (
                  <li>
                    <span>Already paid</span>
                    <strong>{money(paidSoFar, s.currency)}</strong>
                  </li>
                )}
              </ul>

              {canceled && (
                <ErrorBanner>
                  Payment was canceled. You can try again when you are ready.
                </ErrorBanner>
              )}

              {s.stripeEnabled === false ? (
                <ErrorBanner>
                  Card checkout is not configured yet. Please contact the studio.
                </ErrorBanner>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary pay-submit"
                  disabled={payMut.isPending}
                  onClick={() => {
                    setError(null);
                    payMut.mutate();
                  }}
                >
                  <i className="ti ti-credit-card" />
                  {payMut.isPending ? 'Opening checkout…' : 'Pay with card'}
                </button>
              )}

              <p className="pay-secure">
                <i className="ti ti-lock" />
                Secure card payment
              </p>
            </>
          )}

          {s && alreadyPaid && (
            <div className="pay-status pay-status-ok">
              <div className="pay-status-icon">
                <i className="ti ti-circle-check" />
              </div>
              <h1>Paid</h1>
              <div className="pay-amount">{money(s.amountCents, s.currency)}</div>
              <p>This invoice is already paid. Thank you.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
