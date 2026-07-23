import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getPayLinkSummary, payPayLink } from '@/lib/billing';
import { getErrorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { IconReceipt } from '@/components/Icon';

export function PayLink() {
  const { token = '' } = useParams();
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  const summaryQ = useQuery({
    queryKey: ['pay-link', token],
    queryFn: () => getPayLinkSummary(token),
    enabled: token.length > 0,
    retry: false,
  });

  const payMut = useMutation({
    mutationFn: () => payPayLink(token),
    onSuccess: () => {
      setError(null);
      setPaid(true);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const s = summaryQ.data;
  const alreadyPaid = paid || s?.status === 'PAID';

  return (
    <div className="center-screen">
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <div className="card-h">
          <div className="ct" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconReceipt size={18} />
            Secure payment
          </div>
        </div>
        <div className="card-b">
          {summaryQ.isLoading && <div>Loading...</div>}

          {summaryQ.isError && (
            <div className="alert-error">
              This payment link is invalid or has expired.
            </div>
          )}

          {s && !alreadyPaid && (
            <>
              {error && (
                <div className="alert-error" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              )}
              <div style={{ textAlign: 'center', margin: '10px 0 18px' }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {s.customerName ?? 'Customer'}
                </div>
                <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--navy)' }}>
                  {money(s.amountCents, s.currency)}
                </div>
                {s.coversText && (
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                    {s.coversText}
                  </div>
                )}
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={payMut.isPending}
                onClick={() => payMut.mutate()}
              >
                {payMut.isPending ? 'Processing...' : 'Pay now'}
              </button>
            </>
          )}

          {s && alreadyPaid && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div className="chip c-done" style={{ display: 'inline-block' }}>
                Paid
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--navy)', marginTop: 12 }}>
                {money(s.amountCents, s.currency)}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
                Thank you! Your payment has been received.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
