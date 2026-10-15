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

function PaymentColumn({
  emailOnFile,
  banner,
  successHref,
}: {
  emailOnFile: boolean;
  banner?: string | null;
  successHref?: string;
}) {
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
    const result = await checkout.confirm({
      redirect: 'always',
      ...(successHref ? { returnUrl: new URL(successHref, window.location.origin).href } : {}),
    });
    if (result.type === 'error') setMessage(result.error.message);
    setSubmitting(false);
  }

  return (
    <div className="cko-pay">
      <h2>Payment</h2>
      <p className="cko-lead">
        Pay with a wallet, or enter a card. Stripe handles the payment.
      </p>
      {banner && <p className="cko-error">{banner}</p>}
      <form className="cko-form" onSubmit={(event) => void pay(event)}>
        <ExpressCheckoutElement
          onReady={(event) => {
            const methods = event.availablePaymentMethods;
            setWallets(
              Boolean(methods && Object.values(methods).some(Boolean)),
            );
          }}
          onConfirm={async (event) => {
            setMessage(null);
            const result = await checkout.confirm({
              expressCheckoutConfirmEvent: event,
              redirect: 'always',
              ...(successHref ? { returnUrl: new URL(successHref, window.location.origin).href } : {}),
            });
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

export function CheckoutSummaryColumn({
  summary,
  backHref,
  total,
}: {
  summary: CheckoutSummary;
  backHref?: string | null;
  total?: React.ReactNode;
}) {
  const single = summary.groups.length === 1 ? summary.groups[0] : null;
  const heading = single?.orderRef ? 'Order ' + single.orderRef : summary.title;
  const monthly = summary.kind === 'MONTHLY';
  const nextSteps = monthly
    ? [
        ['ti-check', 'Payment confirmed'],
        ['ti-receipt', 'Account balance updated'],
        ['ti-file-check', 'Invoice marked paid'],
      ]
    : [
        ['ti-check', 'Payment confirmed'],
        [
          'ti-pencil',
          summary.kind === 'ADD_ON'
            ? 'We start your revision'
            : 'We start your design',
        ],
        ['ti-folder', 'Files ready in your portal'],
      ];
  return (
    <aside className="cko-summary">
      <div className="cko-brand">
        <img src="/lvd-logo-full.png" alt="Las Vegas Designs USA" />
        {backHref && (
          <Link className="cko-back" to={backHref}>
            <i className="ti ti-arrow-left" />
            Back to {backHref.includes('/orders/') ? 'order' : 'invoice'}
          </Link>
        )}
      </div>
      <p className="cko-kicker">
        {monthly ? 'Invoice summary' : 'Order summary'}
      </p>
      <div className="cko-heading">
        <h1>{heading}</h1>
        {single && (
          <span className="cko-service-pill">{single.serviceLabel}</span>
        )}
      </div>
      <div className="cko-summary-card">
        {summary.groups.map((group, index) => (
          <section className="cko-table-group" key={index}>
            {!single && (
              <div className="cko-group-heading">
                <h2>
                  {group.orderRef
                    ? 'Order ' + group.orderRef
                    : group.orderName || 'Design services'}
                </h2>
                <span className="cko-service-pill">{group.serviceLabel}</span>
              </div>
            )}
            <div className="cko-table-scroll">
              <table className="cko-items">
                <thead>
                  <tr>
                    <th>Design</th>
                    <th>Size</th>
                    <th>Placement</th>
                    <th className="num">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, itemIndex) => (
                    <tr key={itemIndex}>
                      <td>
                        {itemIndex > 0 &&
                        group.items[itemIndex - 1].name === item.name
                          ? ''
                          : item.name}
                      </td>
                      <td>{item.size || item.detail || '—'}</td>
                      <td>{item.placement || '—'}</td>
                      <td className="num">
                        {item.amountCents == null
                          ? '—'
                          : money(item.amountCents, summary.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {group.amountCents != null && !single && (
              <div className="cko-subtotal">
                <span>Order total</span>
                <strong>{money(group.amountCents, summary.currency)}</strong>
              </div>
            )}
          </section>
        ))}
        <div className="cko-totals">
          <div className="cko-row">
            <span>Subtotal</span>
            <span>
              {money(
                summary.amountDueCents + summary.alreadyPaidCents,
                summary.currency,
              )}
            </span>
          </div>
          {summary.alreadyPaidCents > 0 && (
            <div className="cko-row">
              <span>Already paid</span>
              <span>{money(summary.alreadyPaidCents, summary.currency)}</span>
            </div>
          )}
          <div className="cko-row due">
            <span>Total due</span>
            <strong>
              {total ?? money(summary.amountDueCents, summary.currency)}
            </strong>
          </div>
        </div>
      </div>
      <section className="cko-next">
        <h2>What happens next</h2>
        <ol>
          {nextSteps.map(([icon, label]) => (
            <li key={label}>
              <span className="cko-next-icon">
                <i className={'ti ' + icon} aria-hidden />
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="cko-support">
        {!monthly && (
          <span>
            <i className="ti ti-refresh" aria-hidden />
            Free revisions included
          </span>
        )}
        <span>
          <i className="ti ti-message-circle" aria-hidden />
          Questions? <Link to="/portal/messages">Message us</Link>
        </span>
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
  successHref,
}: {
  summary: CheckoutSummary;
  clientSecret: string;
  publishableKey: string;
  emailOnFile: boolean;
  backHref?: string | null;
  banner?: string | null;
  successHref?: string;
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
        <CheckoutSummaryColumn
          summary={summary}
          backHref={backHref}
          total={
            <DueAmount
              currency={summary.currency}
              cents={summary.amountDueCents}
            />
          }
        />
        <PaymentColumn emailOnFile={emailOnFile} banner={banner} successHref={successHref} />
      </div>
    </CheckoutElementsProvider>
  );
}
