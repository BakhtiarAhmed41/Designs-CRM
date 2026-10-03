import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckoutStatus } from '@/components/CheckoutStatus';
import { confirmPayLink, getPayLinkSummary, startPayLinkCheckout } from '@/lib/billing';
import { getErrorMessage } from '@/lib/api';

const CheckoutScreen = lazy(() =>
  import('@/components/CheckoutScreen').then((m) => ({ default: m.CheckoutScreen })),
);

export function PayLink() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const returning = params.get('status') === 'success' || params.get('status') === 'return' || params.get('paid') === '1';
  const [notice, setNotice] = useState<string | null>(null);

  const summaryQ = useQuery({
    queryKey: ['pay-link', token],
    queryFn: () => getPayLinkSummary(token),
    enabled: token.length > 0 && returning,
    retry: false,
  });

  const confirmMut = useMutation({
    mutationFn: () => confirmPayLink(token),
    onSuccess: (summary) => {
      void summaryQ.refetch();
      if (summary.status !== 'PAID') {
        setNotice('Payment was not completed. You can try again.');
      }
    },
  });

  useEffect(() => {
    if (!token || !returning) return;
    confirmMut.mutate();
    // confirm once when Stripe sends the customer back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, returning]);

  const checkoutQ = useQuery({
    queryKey: ['pay-link-checkout', token],
    queryFn: () => startPayLinkCheckout(token),
    enabled: token.length > 0 && (!returning || confirmMut.isSuccess),
    retry: false,
    staleTime: Infinity,
  });

  const confirmed = confirmMut.data ?? summaryQ.data;
  const alreadyPaid = confirmed?.status === 'PAID' || (checkoutQ.data && 'alreadyPaid' in checkoutQ.data);
  const confirming = returning && !alreadyPaid && confirmMut.isPending;

  if (!token) {
    return <CheckoutStatus title="Link unavailable" message="This payment link is invalid or has expired." />;
  }

  if (confirming || (returning && summaryQ.isLoading && !confirmMut.isError)) {
    return <CheckoutStatus title="Confirming payment" message="Checking this payment with Stripe." />;
  }

  if (alreadyPaid) {
    return (
      <CheckoutStatus
        title="Paid"
        message="This invoice is already paid. Thank you."
      />
    );
  }

  if (summaryQ.isError && returning) {
    return <CheckoutStatus title="Link unavailable" message="This payment link is invalid or has expired." />;
  }

  if (checkoutQ.isLoading || (returning && !confirmMut.isSuccess && !confirmMut.isError)) {
    return <CheckoutStatus title="Opening checkout" message="Gathering the order, service, and designs." />;
  }

  if (checkoutQ.isError || confirmMut.isError) {
    return (
      <CheckoutStatus
        title="Could not open checkout"
        message={getErrorMessage(checkoutQ.error ?? confirmMut.error)}
      />
    );
  }

  const session = checkoutQ.data;
  if (!session || 'alreadyPaid' in session) {
    return <CheckoutStatus title="Paid" message="This invoice is already paid. Thank you." />;
  }

  return (
    <Suspense fallback={<CheckoutStatus title="Opening checkout" message="Loading the payment form." />}>
      <CheckoutScreen
        summary={session.summary}
        clientSecret={session.clientSecret}
        publishableKey={session.publishableKey}
        emailOnFile={session.emailOnFile}
        banner={notice}
      />
    </Suspense>
  );
}
