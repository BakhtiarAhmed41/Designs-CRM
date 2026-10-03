import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import {
  CheckoutElementsProvider,
  ContactDetailsElement,
  ExpressCheckoutElement,
  PaymentElement,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout';
import type { CheckoutSummary } from '@/lib/billing';
import { money } from '@/lib/format';
import '@/styles/checkout.css';

const stripeByKey = new Map<string, ReturnType<typeof loadStripe>>();

function stripeFor(publishableKey: string) {
  const key = publishableKey.trim();
  const cached = stripeByKey.get(key);
  if (cached) return cached;
  const created = loadStripe(key);
  stripeByKey.set(key, created);
  return created;
}

const appearance = {
  theme: 'stripe' as const,
  variables: {
    colorPrimary: '#222222',
    colorBackground: '#ffffff',
    colorText: '#222222',
    colorDanger: '#9A1E22',
    borderRadius: '8px',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
};

function DueAmount({ currency, cents }: { currency: string; cents: number }) {
  const state = useCheckoutElements();
  if (state.type === 'success') return <>{state.checkout.total.total.amount}</>;
  return <>{money(cents, currency)}</>;
}

function PaymentColumn({ emailOnFile, banner }: { emailOnFile: boolean; banner?: string | null }) {
  const state = useCheckoutElements();
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [wallets, setWallets] = useState(false);

  if (state.type === 'loading') {
    return (
      <div className="cko-pay">
        <h2>Payment</h2>
        <p className="cko-lead">Loading secure payment form…</p>
      </div>
    );
  }
  if (state.type === 'error') {
    return (
      <div className="cko-pay">
        <h2>Payment</h2>
        <p className="cko-error">{state.error.message}</p>
      </div>
    );
  }

  const { checkout } = state;
  const amount = checkout.total.total.amount;

  async function pay(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const result = await checkout.confirm();
    if (result.type === 'error') setMessage(result.error.message);
    setSubmitting(false);
  }

  return (
    <div className="cko-pay">
      <h2>Payment</h2>
      <p className="cko-lead">Pay with a wallet, or enter a card. Stripe handles the payment.</p>
      {banner && <p className="cko-error">{banner}</p>}
      <form className="cko-form" onSubmit={(event) => void pay(event)}>
        <ExpressCheckoutElement
          onReady={(event) => {
            const methods = event.availablePaymentMethods;
            setWallets(Boolean(methods && Object.values(methods).some(Boolean)));
          }}
          onConfirm={async (event) => {
            setMessage(null);
            const result = await checkout.confirm({ expressCheckoutConfirmEvent: event });
            if (result.type === 'error') setMessage(result.error.message);
          }}
        />
        {wallets && <div className="cko-or">or</div>}
        {!emailOnFile && <ContactDetailsElement />}
        <PaymentElement
          options={{
            layout: 'accordion',
            wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
          }}
        />
        {message && <p className="cko-error">{message}</p>}
        <button className="cko-submit" type="submit" disabled={submitting}>
          {submitting ? 'Processing…' : `Pay ${amount}`}
        </button>
        <p className="cko-secure">
          <i className="ti ti-lock" />
          Secured by Stripe
        </p>
      </form>
    </div>
  );
}

function SummaryColumn({
  summary,
  backHref,
}: {
  summary: CheckoutSummary;
  backHref?: string | null;
}) {
  const single = summary.groups.length === 1 ? summary.groups[0] : null;
  const onlyDesign = single?.items.length === 1 ? single.items[0] : null;
  const heading = single?.orderRef ? `Order ${single.orderRef}` : summary.title;
  const sub =
    single?.orderName && single.orderName !== onlyDesign?.name ? single.orderName : null;
  const note =
    summary.title !== heading && summary.title !== sub && summary.title !== onlyDesign?.name
      ? summary.title
      : null;

  return (
    <aside className="cko-summary">
      <div className="cko-brand">
        <img src="/lvd-logo-full.png" alt="Las Vegas Designs USA" />
        {backHref && (
          <Link className="cko-back" to={backHref}>
            <i className="ti ti-arrow-left" />
            Back
          </Link>
        )}
      </div>
      <p className="cko-kicker">Order summary</p>
      <h1>{heading}</h1>
      {sub && <p className="cko-sub">{sub}</p>}
      {note && <p className="cko-note">{note}</p>}

      <div className="cko-groups">
        {summary.groups.map((group, index) => (
          <section className="cko-group" key={`${group.orderRef ?? group.orderName ?? 'order'}-${index}`}>
            {summary.groups.length > 1 && (group.orderRef || group.orderName) && (
              <h2 className="cko-sub" style={{ marginBottom: 10 }}>
                {group.orderRef ? `Order ${group.orderRef}` : group.orderName}
                {group.orderRef && group.orderName ? ` · ${group.orderName}` : ''}
              </h2>
            )}
            <div className="cko-service">
              <span>Service</span>
              <strong>{group.serviceLabel}</strong>
            </div>
            <span className="cko-label">{group.items.length === 1 ? 'Design' : 'Designs'}</span>
            <ul className="cko-designs">
              {group.items.map((item, itemIndex) => (
                <li key={`${item.name}-${itemIndex}`}>
                  <span className="cko-mark">{itemIndex + 1}</span>
                  <div>
                    <strong>{item.name}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </div>
                  {item.amountCents != null && <b>{money(item.amountCents, summary.currency)}</b>}
                </li>
              ))}
            </ul>
            {group.amountCents != null && (
              <div className="cko-subtotal">
                <span>Order total</span>
                <strong>{money(group.amountCents, summary.currency)}</strong>
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="cko-totals">
        {summary.alreadyPaidCents > 0 && (
          <div className="cko-row">
            <span>Already paid</span>
            <span>{money(summary.alreadyPaidCents, summary.currency)}</span>
          </div>
        )}
        <div className="cko-row due">
          <span>Due today</span>
          <strong>
            <DueAmount currency={summary.currency} cents={summary.amountDueCents} />
          </strong>
        </div>
      </div>
    </aside>
  );
}

export function CheckoutScreen({
  summary,
  clientSecret,
  publishableKey,
  emailOnFile,
  backHref,
  banner,
}: {
  summary: CheckoutSummary;
  clientSecret: string;
  publishableKey: string;
  emailOnFile: boolean;
  backHref?: string | null;
  banner?: string | null;
}) {
  const stripePromise = useMemo(() => {
    const key = (publishableKey || '').trim();
    return key ? stripeFor(key) : null;
  }, [publishableKey]);

  if (!stripePromise) {
    return (
      <div className="cko-status">
        <div className="cko-status-card">
          <img src="/lvd-logo-full.png" alt="Las Vegas Designs USA" />
          <h1>Card checkout is not configured</h1>
          <p>Add the Stripe publishable key, then try this payment again.</p>
          {backHref && <Link to={backHref}>Back</Link>}
        </div>
      </div>
    );
  }

  return (
    <CheckoutElementsProvider
      stripe={stripePromise}
      options={{ clientSecret, elementsOptions: { appearance } }}
    >
      <div className="cko-page">
        <SummaryColumn summary={summary} backHref={backHref} />
        <PaymentColumn emailOnFile={emailOnFile} banner={banner} />
      </div>
    </CheckoutElementsProvider>
  );
}

