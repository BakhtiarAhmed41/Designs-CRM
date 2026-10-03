import { Link } from 'react-router-dom';
import type { QuoteJourneyPhase } from '@/lib/quoteJourney';
import '@/styles/quote-journey.css';

type LivePhase = Exclude<QuoteJourneyPhase, 'closed'>;

const STEPS = [
  { title: 'Preparing your quote' },
  { title: 'Review your quote' },
  { title: 'Pay your invoice' },
] as const;

const STAFF_STEPS = [
  { title: 'Prepare quote' },
  { title: 'Customer review' },
  { title: 'Payment' },
] as const;

function stepIndex(phase: LivePhase) {
  if (phase === 'preparing') return 0;
  if (phase === 'review') return 1;
  if (phase === 'pay') return 2;
  return 3;
}

function stepDetail(index: number, phase: LivePhase) {
  if (index === 0) {
    return phase === 'preparing' ? 'Reviewing your design details' : 'Design details reviewed';
  }
  if (index === 1) {
    return phase === 'preparing' || phase === 'review'
      ? 'Check the price and details'
      : 'Quote confirmed';
  }
  if (phase === 'paid') return 'Payment received';
  if (phase === 'accepted') return 'Added to your account';
  return 'Payment confirms your order';
}

function staffStepDetail(index: number, phase: LivePhase) {
  if (index === 0) return phase === 'preparing' ? 'In progress' : 'Complete';
  if (index === 1) {
    if (phase === 'preparing') return 'Not sent';
    if (phase === 'review') return 'With customer';
    return 'Accepted';
  }
  if (phase === 'paid') return 'Received';
  if (phase === 'accepted') return 'On account';
  if (phase === 'pay') return 'Awaiting';
  return 'Not due';
}

function staffCopy(phase: LivePhase) {
  if (phase === 'preparing') {
    return {
      title: 'Preparing quote',
      subtitle: 'Pricing has not been sent to the customer.',
    };
  }
  if (phase === 'review') {
    return {
      title: 'With customer',
      subtitle: 'Waiting for the customer to review this quote.',
    };
  }
  if (phase === 'pay') {
    return {
      title: 'Awaiting payment',
      subtitle: 'The customer accepted. Payment is still open.',
    };
  }
  if (phase === 'paid') {
    return {
      title: 'Paid',
      subtitle: 'Payment is in. Continue on the order.',
    };
  }
  return {
    title: 'Confirmed',
    subtitle: 'This quote is confirmed. Continue on the order.',
  };
}

function defaultCopy(phase: LivePhase, canChoose: boolean) {
  if (phase === 'preparing') {
    return {
      title: "We're preparing your quote",
      subtitle: "We'll notify you when it's ready to review.",
    };
  }
  if (phase === 'review') {
    return {
      title: 'Your quote is ready',
      subtitle: canChoose
        ? "Review the pricing below and choose the items you'd like to proceed with."
        : 'Review the pricing below.',
    };
  }
  if (phase === 'pay') {
    return {
      title: 'Pay your invoice',
      subtitle: 'Payment confirms your order.',
    };
  }
  if (phase === 'paid') {
    return {
      title: 'Payment received',
      subtitle: "Thank you! Follow your design's progress on the Order page.",
    };
  }
  return {
    title: 'Your order is confirmed',
    subtitle: "Follow your design's progress on the Order page.",
  };
}

export function QuoteJourney({
  phase,
  orderTo,
  canChoose = true,
  paying = false,
  onPay,
  title,
  subtitle,
  audience = 'customer',
}: {
  phase: LivePhase;
  orderTo?: string;
  canChoose?: boolean;
  paying?: boolean;
  onPay?: () => void;
  title?: string;
  subtitle?: string;
  audience?: 'customer' | 'staff';
}) {
  const staff = audience === 'staff';
  const copy = staff ? staffCopy(phase) : defaultCopy(phase, canChoose);
  const steps = staff ? STAFF_STEPS : STEPS;
  const current = stepIndex(phase);
  const finished = phase === 'paid' || phase === 'accepted';

  return (
    <section className="qj" aria-label="Quote progress">
      <h2>{title ?? copy.title}</h2>
      <p className="qj-lead">{subtitle ?? copy.subtitle}</p>
      <ol className="qj-steps">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
          return (
            <li
              key={step.title}
              className={`qj-step is-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <div className="qj-node">
                {state === 'current' && <span className="qj-flag">Current</span>}
                <span className="qj-dot">
                  {state === 'done' ? <i className="ti ti-check" aria-hidden /> : index + 1}
                </span>
              </div>
              <strong className="qj-name">{step.title}</strong>
              <span className="qj-sub">{staff ? staffStepDetail(index, phase) : stepDetail(index, phase)}</span>
            </li>
          );
        })}
      </ol>
      {!finished && (
        <p className="qj-note">
          {staff ? 'The order opens after the customer pays.' : "After payment, you'll be taken to your Order page."}
        </p>
      )}
      {finished && orderTo && (
        <div className="qj-actions">
          <Link className="qj-cta" to={orderTo}>
            View order
          </Link>
        </div>
      )}
      {!finished && phase === 'pay' && onPay && (
        <div className="qj-actions">
          <button type="button" className="qj-cta" disabled={paying} onClick={onPay}>
            {paying ? 'Opening checkout…' : 'Pay now'}
          </button>
        </div>
      )}
    </section>
  );
}

export function OrderSteps({
  ready,
  total,
  delivered,
}: {
  ready: number;
  total: number;
  delivered: number;
}) {
  const one = total === 1;
  const allReady = total > 0 && ready >= total;
  const allDelivered = total > 0 && delivered >= total;
  const partial = delivered > 0 && !allDelivered;
  const remaining = Math.max(total - delivered, 0);
  const lineReady = total > 0 ? Math.round((Math.min(ready, total) / total) * 100) : 0;
  const deliveredLine = total > 0 ? Math.round((Math.min(delivered, total) / total) * 100) : 0;
  const copy = allDelivered
    ? {
        title: 'Your files are ready',
        subtitle: 'View and download your completed files below.',
      }
    : partial
      ? {
          title: `${delivered} of ${total} designs delivered`,
          subtitle:
            delivered === 1
              ? `Your first design is ready. We're still working on the remaining ${remaining === 1 ? 'design' : 'designs'}.`
              : `${delivered} designs are ready. We're still working on the remaining ${remaining === 1 ? 'design' : 'designs'}.`,
        }
    : allReady
      ? {
          title: one ? 'Your design is ready' : 'Your designs are ready',
          subtitle: "We'll notify you when your files are delivered.",
        }
      : {
          title: one ? "We're working on your design" : "We're working on your designs",
          subtitle: "We'll notify you when your files are ready.",
        };
  const steps = [
    {
      title: partial
        ? 'Design in progress'
        : allDelivered && one
          ? 'Design in progress'
          : allReady
            ? one
              ? 'Design ready'
              : 'Designs ready'
            : one
              ? 'Design'
              : 'Designs in progress',
      detail: partial
        ? remaining === 1
          ? '1 design remaining'
          : `${remaining} designs remaining`
        : allDelivered && one
          ? 'Design completed'
          : allReady
            ? one
              ? 'Design prepared'
              : 'All designs prepared'
            : 'Creating your files',
      state: partial ? 'current' : allReady || allDelivered ? 'done' : 'current',
    },
    {
      title: 'Files delivered',
      detail: partial
        ? delivered === 1
          ? '1 design ready to download'
          : `${delivered} designs ready to download`
        : allDelivered
          ? 'Ready to download'
          : allReady
            ? 'In progress'
            : 'Ready to download',
      state: partial ? 'marked' : allDelivered ? 'done' : allReady ? 'current' : 'upcoming',
    },
  ] as const;

  return (
    <div className="ojs">
      <h2>{copy.title}</h2>
      <p className="qj-lead">{copy.subtitle}</p>
      <ol
        className="qj-steps cols-2"
        style={{ ['--line-ready' as string]: `${allReady || allDelivered ? 100 : partial ? deliveredLine : lineReady}%` }}
      >
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={`qj-step is-${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <div className="qj-node">
              {step.state === 'current' && !partial && <span className="qj-flag">Current</span>}
              <span className="qj-dot">
                {step.state === 'done' ? <i className="ti ti-check" aria-hidden /> : index + 1}
              </span>
            </div>
            <strong className="qj-name">{step.title}</strong>
            <span className="qj-sub">{step.detail}</span>
          </li>
        ))}
      </ol>
      {total > 0 && (
        <p className="ojs-count">
          {allDelivered && one ? 'Designs' : one ? 'Design' : 'Designs'} delivered: {delivered} of {total}
        </p>
      )}
    </div>
  );
}

export function RevisionSteps({
  ready,
  total,
  published,
  awaitingPayment = false,
  progressLabel,
}: {
  ready: number;
  total: number;
  published: number;
  awaitingPayment?: boolean;
  progressLabel?: string;
}) {
  const allReady = total > 0 && ready >= total;
  const allPublished = total > 0 && published >= total;
  const lineReady = total > 0 ? Math.round((Math.min(ready, total) / total) * 100) : 0;
  const many = total !== 1;
  const copy = allPublished
    ? {
        title: 'Your revised files are ready',
        subtitle: 'View your updated preview and download the latest files below.',
      }
    : awaitingPayment && !allReady
      ? {
          title: many ? 'Your revisions are waiting for payment' : 'Your revision is waiting for payment',
          subtitle: many ? "We'll start each revision once it's paid." : "We'll start as soon as it's paid.",
        }
      : allReady
        ? {
            title: many ? 'Your revisions are ready' : 'Your revision is ready',
            subtitle: "We'll notify you when your files are delivered.",
          }
        : {
            title: many ? "We're updating your designs" : "We're updating your design",
            subtitle: "We'll notify you when your revised files are ready.",
          };
  const working = !allPublished && !allReady && !awaitingPayment;
  const steps = allPublished
    ? ([
        {
          title: many ? 'Revisions completed' : 'Revision completed',
          detail: 'Your requested changes are complete',
          state: 'done',
        },
        {
          title: 'Revised files delivered',
          detail: 'Ready to view and download',
          state: 'done',
        },
      ] as const)
    : working
    ? ([
        {
          title: 'Revision in progress',
          detail: 'Making your requested changes',
          state: 'current',
        },
        {
          title: 'Revised files delivered',
          detail: 'Awaiting updated files',
          state: 'upcoming',
        },
      ] as const)
    : ([
        {
          title: allReady ? (many ? 'Revisions ready' : 'Revision ready') : 'Revision in progress',
          detail: allReady
            ? many
              ? 'All revisions prepared'
              : 'Revision prepared'
            : awaitingPayment
              ? 'Waiting for payment'
              : 'Updating your files',
          state: allReady ? 'done' : 'current',
        },
        {
          title: 'Files delivered',
          detail: allPublished ? 'Ready to download' : allReady ? 'In progress' : 'Ready to download',
          state: allPublished ? 'done' : allReady ? 'current' : 'upcoming',
        },
      ] as const);
  const noun = many ? 'revisions' : 'revision';

  return (
    <div className="ojs">
      <h2>{copy.title}</h2>
      <p className="qj-lead">{copy.subtitle}</p>
      <ol
        className="qj-steps cols-2"
        style={{ ['--line-ready' as string]: `${allReady ? 100 : lineReady}%` }}
      >
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={`qj-step is-${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <div className="qj-node">
              {step.state === 'current' && <span className="qj-flag">Current</span>}
              <span className="qj-dot">
                {step.state === 'done' ? <i className="ti ti-check" aria-hidden /> : index + 1}
              </span>
            </div>
            <strong className="qj-name">{step.title}</strong>
            <span className="qj-sub">{step.detail}</span>
          </li>
        ))}
      </ol>
      {total > 0 && (
        <p className="ojs-count">
          {(working || allPublished) && progressLabel ? progressLabel : `${published} of ${total} ${noun} published`}
        </p>
      )}
    </div>
  );
}

export function QuotePricingEmpty({
  declined = false,
  settled = false,
  reason,
}: {
  declined?: boolean;
  settled?: boolean;
  reason?: string | null;
}) {
  if (declined) {
    return (
      <div className="qj-empty">
        <i className="ti ti-alert-circle" aria-hidden />
        <strong>This request was declined</strong>
        <p>{reason?.trim() || 'The team declined this request. Start a chat if you need help with a new one.'}</p>
      </div>
    );
  }
  if (settled) {
    return (
      <div className="qj-empty">
        <i className="ti ti-file-text" aria-hidden />
        <strong>No priced items on this quote</strong>
        <p>Open the order to see the final total.</p>
      </div>
    );
  }
  return (
    <div className="qj-empty">
      <i className="ti ti-file-text" aria-hidden />
      <strong>Pricing is being prepared</strong>
      <p>Your prices will appear here once we've reviewed your request.</p>
    </div>
  );
}
