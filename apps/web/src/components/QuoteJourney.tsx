import { Link } from 'react-router-dom';
import type { QuoteJourneyPhase } from '@/lib/quoteJourney';
import '@/styles/quote-journey.css';

type LivePhase = Exclude<QuoteJourneyPhase, 'closed'>;

const STEPS = [
  { title: 'Preparing your quote' },
  { title: 'Review your quote' },
  { title: 'Pay your invoice' },
] as const;

function staffSteps(phase: LivePhase) {
  if (phase === 'preparing') {
    return [
      { title: 'Prepare quote' },
      { title: 'Customer approval' },
      { title: 'Payment' },
    ] as const;
  }
  if (phase === 'paid' || phase === 'accepted') {
    return [
      { title: 'Quote prepared' },
      { title: 'Customer approved' },
      { title: 'Payment received' },
    ] as const;
  }
  return [
    { title: 'Quote prepared' },
    { title: 'Customer approval' },
    { title: 'Payment' },
  ] as const;
}

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

function staffStepDetail(
  index: number,
  phase: LivePhase,
  opts?: { revised?: boolean },
) {
  if (index === 0) {
    if (phase === 'preparing') return 'Needs pricing';
    if (phase === 'paid' || phase === 'accepted') return '';
    if (opts?.revised) return 'Revised quote sent';
    return 'Sent to customer';
  }
  if (index === 1) {
    if (phase === 'preparing') return 'Not sent yet';
    if (phase === 'review') return 'Awaiting approval';
    return '';
  }
  if (phase === 'paid' || phase === 'accepted') return '';
  return 'Pending';
}

function staffCopy(phase: LivePhase, opts?: { revised?: boolean }) {
  if (phase === 'preparing') {
    return {
      title: 'Quote request received',
      subtitle: 'Review the design details and prepare your quote.',
    };
  }
  if (phase === 'review') {
    return {
      title: opts?.revised ? 'Revised quote sent to customer' : 'Quote sent to customer',
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
      title: 'Payment received',
      subtitle: 'This quote has been converted to an order.',
    };
  }
  return {
    title: 'Payment received',
    subtitle: 'This quote has been converted to an order.',
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
  revised = false,
  meta,
}: {
  phase: LivePhase;
  orderTo?: string;
  canChoose?: boolean;
  paying?: boolean;
  onPay?: () => void;
  title?: string;
  subtitle?: string;
  /** Extra line under the subtitle, such as the paid date and version. */
  meta?: string;
  audience?: 'customer' | 'staff';
  /** Staff: whether the latest sent quote is a revision (v2+). */
  revised?: boolean;
}) {
  const staff = audience === 'staff';
  const copy = staff ? staffCopy(phase, { revised }) : defaultCopy(phase, canChoose);
  const steps = staff ? staffSteps(phase) : STEPS;
  const current = stepIndex(phase);
  const finished = phase === 'paid' || phase === 'accepted';
  const lead = subtitle ?? copy.subtitle;

  return (
    <section className={`qj${staff ? ' qj-staff' : ''}`} aria-label="Quote progress">
      <div className="qj-top">
        <div>
          <h2>{title ?? copy.title}</h2>
          {lead ? <p className="qj-lead">{lead}</p> : null}
          {meta ? <p className="qj-meta">{meta}</p> : null}
        </div>
        {finished && orderTo && (
          <div className="qj-actions qj-actions-inline">
            <Link className="qj-cta" to={orderTo}>
              <i className="ti ti-external-link" aria-hidden /> View order
            </Link>
          </div>
        )}
      </div>
      <ol className="qj-steps">
        {steps.map((step, index) => {
          const state =
            finished || index < current ? 'done' : index === current ? 'current' : 'upcoming';
          const detail = staff
            ? staffStepDetail(index, phase, { revised })
            : stepDetail(index, phase);
          return (
            <li
              key={`${step.title}-${index}`}
              className={`qj-step is-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <div className="qj-node">
                {state === 'current' && !staff && <span className="qj-flag">Current</span>}
                <span className="qj-dot">
                  {state === 'done' ? <i className="ti ti-check" aria-hidden /> : index + 1}
                </span>
              </div>
              <strong className="qj-name">{step.title}</strong>
              {detail ? <span className="qj-sub">{detail}</span> : null}
            </li>
          );
        })}
      </ol>
      {!finished && !staff && (
        <p className="qj-note">After payment, you'll be taken to your Order page.</p>
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
  audience = 'customer',
}: {
  ready: number;
  total: number;
  delivered: number;
  audience?: 'customer' | 'staff';
}) {
  const staff = audience === 'staff';
  const one = total === 1;
  const allReady = total > 0 && ready >= total;
  const allDelivered = total > 0 && delivered >= total;
  const partial = delivered > 0 && !allDelivered;
  const remaining = Math.max(total - delivered, 0);
  const lineReady = total > 0 ? Math.round((Math.min(ready, total) / total) * 100) : 0;
  const deliveredLine = total > 0 ? Math.round((Math.min(delivered, total) / total) * 100) : 0;
  const copy = allDelivered
    ? {
        title: staff ? 'Files delivered' : 'Your files are ready',
        subtitle: staff
          ? 'The customer can view and download the completed files.'
          : 'View and download your completed files below.',
      }
    : partial
      ? {
          title: `${delivered} of ${total} designs delivered`,
          subtitle: staff
            ? delivered === 1
              ? `The first design is delivered. ${remaining === 1 ? '1 design is' : `${remaining} designs are`} still in progress.`
              : `${delivered} designs are delivered. ${remaining === 1 ? '1 design is' : `${remaining} designs are`} still in progress.`
            : delivered === 1
              ? `Your first design is ready. We're still working on the remaining ${remaining === 1 ? 'design' : 'designs'}.`
              : `${delivered} designs are ready. We're still working on the remaining ${remaining === 1 ? 'design' : 'designs'}.`,
        }
    : allReady
      ? {
          title: staff
            ? one
              ? 'Design ready to send'
              : 'Designs ready to send'
            : one
              ? 'Your design is ready'
              : 'Your designs are ready',
          subtitle: staff
            ? 'Publish the files when you are ready to deliver.'
            : "We'll notify you when your files are delivered.",
        }
      : {
          title: staff
            ? one
              ? 'Working on this design'
              : 'Working on these designs'
            : one
              ? "We're working on your design"
              : "We're working on your designs",
          subtitle: staff
            ? 'Mark the work ready, then deliver the files.'
            : "We'll notify you when your files are ready.",
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
            ? staff
              ? one
                ? 'Ready to send'
                : 'All designs prepared'
              : one
                ? 'Design prepared'
                : 'All designs prepared'
            : staff
              ? 'Creating the files'
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
          ? staff
            ? 'Sent to the customer'
            : 'Ready to download'
          : allReady
            ? 'In progress'
            : staff
              ? 'Not delivered yet'
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
              {step.state === 'current' && !partial && !staff && <span className="qj-flag">Current</span>}
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
  audience = 'customer',
}: {
  ready: number;
  total: number;
  published: number;
  awaitingPayment?: boolean;
  progressLabel?: string;
  audience?: 'customer' | 'staff';
}) {
  const staff = audience === 'staff';
  const allReady = total > 0 && ready >= total;
  const allPublished = total > 0 && published >= total;
  const lineReady = total > 0 ? Math.round((Math.min(ready, total) / total) * 100) : 0;
  const many = total !== 1;
  const copy = allPublished
    ? {
        title: staff ? 'Revised files delivered' : 'Your revised files are ready',
        subtitle: staff
          ? 'The customer can view the updated preview and download the latest files.'
          : 'View your updated preview and download the latest files below.',
      }
    : awaitingPayment && !allReady
      ? {
          title: staff
            ? many
              ? 'Revisions waiting for payment'
              : 'Revision waiting for payment'
            : many
              ? 'Your revisions are waiting for payment'
              : 'Your revision is waiting for payment',
          subtitle: staff
            ? many
              ? 'Each revision starts once the customer pays.'
              : 'This revision starts once the customer pays.'
            : many
              ? "We'll start each revision once it's paid."
              : "We'll start as soon as it's paid.",
        }
      : allReady
        ? {
            title: staff
              ? many
                ? 'Revisions ready to send'
                : 'Revision ready to send'
              : many
                ? 'Your revisions are ready'
                : 'Your revision is ready',
            subtitle: staff
              ? 'Publish the revised files when you are ready.'
              : "We'll notify you when your files are delivered.",
          }
        : {
            title: staff
              ? many
                ? 'Revisions in progress'
                : 'Revision in progress'
              : many
                ? "We're updating your designs"
                : "We're updating your design",
            subtitle: staff
              ? 'The requested changes are underway.'
              : "We'll notify you when your revised files are ready.",
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
              {step.state === 'current' && !staff && <span className="qj-flag">Current</span>}
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
