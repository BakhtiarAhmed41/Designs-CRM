import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckoutScreen } from '@/components/CheckoutScreen';
import { CheckoutStatus } from '@/components/CheckoutStatus';
import { startMyInvoiceCheckout, startMyOrderCheckout } from '@/lib/billing';
import { getErrorMessage } from '@/lib/api';

function safeReturn(path: string | null, fallback: string) {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return fallback;
  }
  return path;
}

export function CheckoutPage() {
  const { orderId, invoiceId } = useParams();
  const [params] = useSearchParams();
  const fallback = orderId ? `/portal/orders/${orderId}` : '/portal/invoices';
  const returnPath = safeReturn(params.get('return'), fallback);

  const session = useQuery({
    queryKey: ['checkout-session', orderId ?? '', invoiceId ?? '', returnPath],
    queryFn: () =>
      orderId
        ? startMyOrderCheckout(orderId, returnPath)
        : startMyInvoiceCheckout(invoiceId ?? '', returnPath),
    enabled: Boolean(orderId || invoiceId),
    retry: false,
    staleTime: Infinity,
  });

  if (session.isLoading) {
    return (
      <CheckoutStatus title="Opening checkout" message="Gathering the order, service, and designs." />
    );
  }

  if (session.isError) {
    return (
      <CheckoutStatus
        title="Could not open checkout"
        message={getErrorMessage(session.error)}
        backHref={returnPath}
      />
    );
  }

  const result = session.data;
  if (!result) return null;
  if ('alreadyPaid' in result) {
    return (
      <CheckoutStatus
        title="Already paid"
        message="This invoice is already paid. Nothing else is due."
        backHref={returnPath}
        backLabel="Back to your order"
      />
    );
  }

  return (
    <CheckoutScreen
      summary={result.summary}
      clientSecret={result.clientSecret}
      publishableKey={result.publishableKey}
      emailOnFile={result.emailOnFile}
      backHref={returnPath}
    />
  );
}
