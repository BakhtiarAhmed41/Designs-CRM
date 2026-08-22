import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPayLinkSummary } from '@/lib/billing';
import { money } from '@/lib/format';
import { ErrorBanner } from '@/components/ui/EmptyState';

export function PayLink() {
  const { token = '' } = useParams();

  const summaryQ = useQuery({
    queryKey: ['pay-link', token],
    queryFn: () => getPayLinkSummary(token),
    enabled: token.length > 0,
    retry: false,
  });

  const s = summaryQ.data;
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

          {s && !alreadyPaid && (
            <>
              <div style={{ textAlign: 'center', margin: '8px 0 20px' }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {s.customerName ?? 'Customer'}
                </div>
                <div className="pay-amount">{money(s.amountCents, s.currency)}</div>
                {s.coversText && (
                  <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>
                    {s.coversText}
                  </div>
                )}
              </div>
              {/* TODO(payment): integrate Stripe once keys are provided */}
              <div className="alert-error" style={{ marginBottom: 0 }}>
                Payment integration coming soon. This page does not charge a card
                or mark the invoice paid. Please pay the team directly, or use
                store credit in the portal if you have a balance.
              </div>
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
