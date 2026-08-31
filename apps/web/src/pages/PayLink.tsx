import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { confirmPayLink, getPayLinkSummary, startPayLinkCheckout } from '@/lib/billing';
import { getErrorMessage } from '@/lib/api';
import { money } from '@/lib/format';
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

  return (
    <div className="center-screen" style={{ padding: 24, alignItems: 'center' }}>
      <div className="pay-card">
        <div className="pay-brand">
          <img src="/lvd-logo.png" alt="Las Vegas Designs USA" style={{ height: 32 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>
              Las Vegas Designs USA
            </div>
            <div style={{ fontSize: 12, color: 'var(--faint)' }}>Invoice</div>
          </div>
        </div>
        <div className="card-b">
          {summaryQ.isLoading && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Loading invoice…
            </div>
          )}

          {summaryQ.isError && (
            <ErrorBanner>This payment link is invalid or has expired.</ErrorBanner>
          )}

          {error && <ErrorBanner>{error}</ErrorBanner>}

          {s && !alreadyPaid && (
            <>
              <div style={{ textAlign: 'center', margin: '8px 0 20px' }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {s.customerName ?? 'Customer'}
                </div>
                <div className="pay-amount">{money(s.amountCents, s.currency)}</div>
                {s.status === 'PARTIAL' && (
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                    Balance due
                  </div>
                )}
                {s.coversText && (
                  <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>
                    {s.coversText}
                  </div>
                )}
              </div>
              {canceled && (
                <div className="alert-error" style={{ marginBottom: 12 }}>
                  Payment was canceled. You can try again when you are ready.
                </div>
              )}
              {s.stripeEnabled === false ? (
                <div className="alert-error" style={{ marginBottom: 0 }}>
                  Card checkout is not configured yet. Please contact the studio.
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={payMut.isPending}
                  onClick={() => {
                    setError(null);
                    payMut.mutate();
                  }}
                >
                  <i className="ti ti-credit-card" />{' '}
                  {payMut.isPending ? 'Opening checkout…' : 'Pay with card'}
                </button>
              )}
            </>
          )}

          {s && alreadyPaid && (
            <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
              <span className="chip c-done">Paid</span>
              <div className="pay-amount" style={{ marginTop: 12 }}>
                {money(s.amountCents, s.currency)}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 8 }}>
                This invoice is already paid. Thank you.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
