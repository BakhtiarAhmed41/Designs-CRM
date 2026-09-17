import { useEffect, useState } from 'react';

const COMPLETE_POLICY_URL = 'https://lasvegasdesignsusa.com/refund-policy/';
const CONTACT_EMAIL = 'sales@lasvegasdesignsusa.com';

type OutcomeCard = { title: string; text: string; positive?: boolean };

type Block =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'subbox'; label: string; items: string[] }
  | { type: 'outcome'; text: string; extra?: string }
  | { type: 'caution'; text: string }
  | { type: 'outcomes'; cards: OutcomeCard[] }
  | { type: 'note'; text: string }
  | { type: 'contact' }
  | { type: 'caveat'; text: string };

type PolicySection = { id: string; n: string; title: string; blocks: Block[] };

const FULL_POLICY: PolicySection[] = [
  {
    id: 'sec-01',
    n: '01',
    title: 'Cancellation before work starts',
    blocks: [
      {
        type: 'p',
        text: 'If you cancel your order **before production has started**, you may request either a full refund or store credit for a future order.',
      },
      {
        type: 'p',
        text: 'Once work has started, cancellation and refund options become limited because time has already been spent creating your custom file.',
      },
    ],
  },
  {
    id: 'sec-02',
    n: '02',
    title: 'After work has started or files have been delivered',
    blocks: [
      {
        type: 'p',
        text: 'Because our services are custom-made digital products, refunds are not normally available once:',
      },
      {
        type: 'ul',
        items: [
          'Work has started.',
          'A preview or design direction has been approved.',
          'The completed digital files have been delivered.',
          'The customer changes their mind after production has begun.',
        ],
      },
      {
        type: 'outcome',
        text: 'If there is a problem with the delivered file, we will first review the issue and provide reasonable revisions or corrections.',
      },
    ],
  },
  {
    id: 'sec-03',
    n: '03',
    title: 'When a refund may be provided',
    blocks: [
      { type: 'p', text: 'A full or partial refund may be considered when:' },
      {
        type: 'ul',
        items: [
          'We are unable to complete or deliver the agreed service.',
          'The delivered file does not follow the confirmed instructions.',
          'A confirmed file-related issue cannot be corrected through reasonable revisions.',
          'A sample stitch-out or other reasonable testing confirms that the problem was caused by our file.',
        ],
      },
      {
        type: 'outcome',
        text: 'If a confirmed problem is caused by our work and cannot be corrected, we will provide an appropriate refund.',
        extra:
          'Every request is reviewed individually based on the order details, files delivered, work completed, and evidence provided.',
      },
    ],
  },
  {
    id: 'sec-04',
    n: '04',
    title: 'Store credit and future-order compensation',
    blocks: [
      { type: 'p', text: 'In some cases, instead of issuing a refund, we may offer:' },
      {
        type: 'ul',
        items: [
          'Full or partial store credit.',
          "Credit carried forward to the customer's next order.",
          'A complimentary service or adjustment on a future order.',
          "A discount on the customer's next order.",
        ],
      },
      {
        type: 'p',
        text: 'The amount and type of compensation will depend on the circumstances and will be confirmed with the customer in writing.',
      },
      {
        type: 'subbox',
        label: 'Store credit details',
        items: [
          "Is linked to the customer's account.",
          'Can be applied to a future order.',
          'Is not transferable to another customer.',
          'Cannot normally be exchanged for cash after it has been accepted.',
        ],
      },
      {
        type: 'outcome',
        text: 'Future-order discounts and complimentary services are offered at our discretion and do not automatically apply to every refund request.',
      },
    ],
  },
  {
    id: 'sec-05',
    n: '05',
    title: 'When refunds are not applicable',
    blocks: [
      { type: 'p', text: 'Refunds will not normally be issued when:' },
      {
        type: 'ul',
        items: [
          'The customer changes their mind after work has started.',
          'Incorrect, incomplete, or unclear instructions were provided.',
          'The wrong size, placement, format, fabric, machine, or software information was supplied.',
          "The delivered file matches the approved instructions, but the customer's expectations later change.",
          'A preview or design direction was approved and later rejected.',
          'The customer requests new artwork or a different design after completion.',
          'The customer is unfamiliar with embroidery, printing, cutting, engraving, or the required production process.',
          'The problem is caused by equipment, materials, software, or production conditions outside our control.',
        ],
      },
    ],
  },
  {
    id: 'sec-06',
    n: '06',
    title: 'Production-related limitations',
    blocks: [
      {
        type: 'p',
        text: "Digital-file performance can be affected by the customer's production setup. Refunds do not apply to problems caused by:",
      },
      {
        type: 'ul',
        items: [
          'Embroidery machine settings or machine limitations.',
          'Incorrect thread tension or machine speed.',
          'Thread type, thread quality, needle type, or needle condition.',
          'Fabric type, stretch, thickness, or fabric movement.',
          'Incorrect or insufficient stabilizer and backing.',
          'Improper hooping, trimming, or production technique.',
          'Incorrect printer, cutter, laser, CNC, or software settings.',
          'Incorrect material type or thickness.',
          'Failure to test the file before full production.',
          'Other production conditions outside our control.',
        ],
      },
      {
        type: 'outcome',
        text: 'We will still try to help identify the issue and recommend possible adjustments whenever reasonably possible.',
      },
    ],
  },
  {
    id: 'sec-07',
    n: '07',
    title: 'Sample stitch-out and file testing',
    blocks: [
      {
        type: 'p',
        text: 'If an embroidery problem continues after reasonable troubleshooting, we may recommend or arrange a sample stitch-out. The customer may be asked to provide:',
      },
      {
        type: 'ul',
        items: [
          'Clear photographs or videos of the stitched result.',
          'Machine make and model.',
          'Fabric and stabilizer details.',
          'Needle and thread information.',
          'Final design size.',
          'Relevant machine settings.',
        ],
      },
      {
        type: 'outcomes',
        cards: [
          {
            title: 'If our file caused it',
            text: 'We correct the file. If the confirmed issue can\'t be corrected, we refund the applicable payment.',
            positive: true,
          },
          {
            title: 'If the file wasn\'t the cause',
            text: 'Any agreed sample stitch-out or production-testing charge remains payable.',
          },
        ],
      },
      { type: 'note', text: 'Any testing charge will be explained and approved before testing begins.' },
    ],
  },
  {
    id: 'sec-08',
    n: '08',
    title: 'Free minor revisions',
    blocks: [
      {
        type: 'p',
        text: 'Minor revisions that remain within the original instructions are normally provided free of charge. Free minor revisions may include:',
      },
      {
        type: 'ul',
        items: [
          'Minor stitch or path corrections.',
          'Spacing and alignment adjustments.',
          'Small text corrections that do not change the overall design.',
          'Minor cleanup to improve stitching, cutting, printing, or engraving.',
          'Simple color changes.',
          'Simple embroidery thread-color changes.',
          'Additional available file formats for the same approved design.',
          'Size adjustments of up to approximately 20 percent, where technically possible without recreating or re-digitizing the design.',
        ],
      },
      {
        type: 'outcome',
        text: 'Customers may request the available file formats they need for the same completed design at no additional charge.',
      },
    ],
  },
  {
    id: 'sec-09',
    n: '09',
    title: 'Major revisions and additional charges',
    blocks: [
      {
        type: 'p',
        text: 'Additional charges may apply when a request requires substantial new work, including:',
      },
      {
        type: 'ul',
        items: [
          'Recreating or redrawing artwork.',
          'Rebuilding or re-digitizing the design.',
          'Adding or removing major objects or details.',
          'Changing the approved artwork.',
          'Changing the layout or composition.',
          'Creating a substantially different size.',
          'Making a size change that requires re-digitizing.',
          'Preparing a different version for a new purpose.',
          'Changing instructions after a preview has been approved.',
          'Requesting work outside the original order.',
        ],
      },
      {
        type: 'outcome',
        text: "We will explain any additional charge and obtain the customer's approval before beginning the extra work.",
      },
    ],
  },
  {
    id: 'sec-10',
    n: '10',
    title: 'Customer responsibilities',
    blocks: [
      {
        type: 'p',
        text: 'Customers are responsible for providing accurate and complete information, including:',
      },
      {
        type: 'ul',
        items: [
          'Final artwork or clear reference images.',
          'Correct size and placement.',
          'Required file formats.',
          'Machine or software information.',
          'Fabric, material, and intended application.',
          'Cut, print, stitch, or engraving instructions.',
          'Any special production requirements.',
        ],
      },
      {
        type: 'outcome',
        text: 'Changes caused by missing, incorrect, or incomplete information may require an additional charge.',
        extra: 'Customers should review previews carefully and test delivered files before beginning full production.',
      },
    ],
  },
  {
    id: 'sec-11',
    n: '11',
    title: 'Chargebacks and disputes',
    blocks: [
      {
        type: 'p',
        text: 'Please contact us before opening a payment dispute or chargeback. Most problems can be resolved through troubleshooting, file corrections, revisions, store credit, or another mutually agreed solution.',
      },
      {
        type: 'caution',
        text: 'If a chargeback is opened while we are actively reviewing or correcting an issue, work on the order may be paused until the dispute is resolved.',
      },
    ],
  },
  {
    id: 'sec-12',
    n: '12',
    title: 'Contact us',
    blocks: [
      {
        type: 'p',
        text: 'To request a refund, revision, store credit, or file review, please provide:',
      },
      {
        type: 'ul',
        items: [
          'Your order number.',
          'A clear explanation of the issue.',
          'Photographs, videos, or screenshots where applicable.',
          'Your machine, material, fabric, size, and production details where relevant.',
        ],
      },
      { type: 'contact' },
    ],
  },
];

const SUMMARY: PolicySection[] = [
  {
    id: 'summary-01',
    n: '01',
    title: 'Refund eligibility',
    blocks: [
      { type: 'p', text: 'You may cancel for a full refund before work starts.' },
      {
        type: 'ul',
        items: [
          'Once work starts or digital files are delivered, refunds are limited.',
          'If a confirmed issue from our side cannot be corrected, we will provide an appropriate refund.',
        ],
      },
    ],
  },
  {
    id: 'summary-02',
    n: '02',
    title: 'Store credit and compensation',
    blocks: [
      { type: 'p', text: 'Some cases may be resolved with credit instead of a refund.' },
      {
        type: 'ul',
        items: [
          'Credit can be carried forward to your next order.',
          'We may also offer a future-order discount or complimentary adjustment.',
        ],
      },
    ],
  },
  {
    id: 'summary-03',
    n: '03',
    title: 'Free revisions',
    blocks: [
      { type: 'p', text: 'Minor changes within the original request are usually free.' },
      {
        type: 'ul',
        items: [
          'Simple color and thread-color changes.',
          'Additional available file formats for the same design.',
          'Size adjustments up to approximately 20 percent, where technically possible.',
        ],
      },
      { type: 'caveat', text: 'Major redesigns or artwork changes may cost extra.' },
    ],
  },
  {
    id: 'summary-04',
    n: '04',
    title: 'Machine and production issues',
    blocks: [
      { type: 'p', text: 'Digital-file results also depend on your machine, materials, and settings.' },
      {
        type: 'ul',
        items: [
          'Machine settings, tension, fabric, stabilizer, and hooping are outside our control.',
          'If a problem continues, we may request photographs, videos, or a sample stitch-out.',
          'If testing confirms our file caused the issue, we will correct it or provide an appropriate refund.',
        ],
      },
    ],
  },
  {
    id: 'summary-05',
    n: '05',
    title: 'Before opening a dispute',
    blocks: [
      {
        type: 'p',
        text: 'Please message us with your order number and details. Most concerns can be resolved through troubleshooting, revisions, store credit, or another agreed solution.',
      },
    ],
  },
];

const RAIL_FULL = [
  { id: 'sec-01', label: '01 · Cancellation' },
  { id: 'sec-02', label: '02 · After work starts' },
  { id: 'sec-03', label: '03 · Refunds provided' },
  { id: 'sec-04', label: '04 · Store credit' },
  { id: 'sec-05', label: '05 · Not applicable' },
  { id: 'sec-06', label: '06 · Production limits' },
  { id: 'sec-07', label: '07 · Stitch-out testing' },
  { id: 'sec-08', label: '08 · Free revisions' },
  { id: 'sec-09', label: '09 · Major revisions' },
  { id: 'sec-10', label: '10 · Responsibilities' },
  { id: 'sec-11', label: '11 · Chargebacks' },
  { id: 'sec-12', label: '12 · Contact us' },
];

const RAIL_SUMMARY = [
  { id: 'summary-01', label: '01 · Eligibility' },
  { id: 'summary-02', label: '02 · Compensation' },
  { id: 'summary-03', label: '03 · Free revisions' },
  { id: 'summary-04', label: '04 · Production issues' },
  { id: 'summary-05', label: '05 · Before a dispute' },
];

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function PolicyBlocks({ id, blocks }: { id: string; blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        const key = `${id}-${block.type}-${i}`;
        if (block.type === 'ul') {
          return (
            <ul key={key} className="policy-list">
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'subbox') {
          return (
            <div key={key} className="policy-subbox">
              <span className="policy-subbox-label">{block.label}</span>
              <ul className="policy-list">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          );
        }
        if (block.type === 'outcome') {
          return (
            <div key={key} className="policy-callout policy-outcome">
              <i className="ti ti-circle-check" aria-hidden />
              <div>
                <p>{block.text}</p>
                {block.extra ? <p>{block.extra}</p> : null}
              </div>
            </div>
          );
        }
        if (block.type === 'caution') {
          return (
            <div key={key} className="policy-callout policy-caution">
              <i className="ti ti-alert-circle" aria-hidden />
              <p>{block.text}</p>
            </div>
          );
        }
        if (block.type === 'outcomes') {
          return (
            <div key={key} className="policy-outcome-cards">
              {block.cards.map((card) => (
                <div
                  key={card.title}
                  className={`policy-outcome-card${card.positive ? ' is-positive' : ''}`}
                >
                  <div className="policy-outcome-card-title">
                    <i
                      className={`ti ${card.positive ? 'ti-circle-check' : 'ti-alert-circle'}`}
                      aria-hidden
                    />
                    {card.title}
                  </div>
                  <p>{card.text}</p>
                </div>
              ))}
            </div>
          );
        }
        if (block.type === 'note') {
          return (
            <p key={key} className="policy-note">
              {block.text}
            </p>
          );
        }
        if (block.type === 'caveat') {
          return (
            <div key={key} className="policy-caveat">
              <i className="ti ti-alert-circle" aria-hidden />
              <span>{block.text}</span>
            </div>
          );
        }
        if (block.type === 'contact') {
          return (
            <div key={key} className="policy-contact">
              <p>Reach our team directly and we'll review the information and respond with the appropriate next step.</p>
              <a className="policy-email" href={`mailto:${CONTACT_EMAIL}`}>
                <i className="ti ti-mail" aria-hidden />
                {CONTACT_EMAIL}
              </a>
            </div>
          );
        }
        return (
          <p key={key}>
            <RichText text={block.text} />
          </p>
        );
      })}
    </>
  );
}

function DocHeader({
  icon,
  kicker,
  title,
  desc,
  id,
}: {
  icon: string;
  kicker: string;
  title: string;
  desc: string;
  id?: string;
}) {
  return (
    <header className="policy-card policy-hero" id={id}>
      <div className="policy-hero-icon" aria-hidden>
        <i className={`ti ${icon}`} />
      </div>
      <p className="policy-kicker">{kicker}</p>
      <h1>{title}</h1>
      <p className="policy-sub">{desc}</p>
    </header>
  );
}

function SectionList({ sections }: { sections: PolicySection[] }) {
  return (
    <article className="policy-card policy-doc">
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="policy-section">
          <div className="policy-section-head">
            <span className="policy-num">{section.n}</span>
            <h2>{section.title}</h2>
          </div>
          <div className="policy-section-body">
            <PolicyBlocks id={section.id} blocks={section.blocks} />
          </div>
        </section>
      ))}
    </article>
  );
}

export function PortalPolicies() {
  const [activeId, setActiveId] = useState('sec-01');
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const page = document.querySelector('.policy-page') as HTMLElement | null;
    const root = getScrollParent(page);
    const ids = [...RAIL_FULL, ...RAIL_SUMMARY].map((item) => item.id);
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;

    const onScroll = () => {
      const top = root ? root.scrollTop : window.scrollY;
      setShowTop(top > 500);
    };
    const scrollEl: HTMLElement | Window = root ?? window;
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveId(visible[0].target.id);
      },
      { root, rootMargin: '-18% 0px -70% 0px', threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));

    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  function scrollToTop() {
    const page = document.querySelector('.policy-page') as HTMLElement | null;
    const root = getScrollParent(page);
    if (root) root.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="policy-page">
      <div className="policy-main">
        <DocHeader
          icon="ti-scale"
          kicker="Las Vegas Designs USA · Policies"
          title="Refund, Store Credit and Revision Policy"
          desc="This policy explains when refunds, store credit, revisions, file testing, and additional charges may apply to custom digital services. Our first priority is to correct any confirmed file issue and deliver a usable result."
        />

        <nav className="policy-card policy-toc" aria-label="On this page">
          <p className="policy-toc-label">On this page</p>
          <ol>
            {FULL_POLICY.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <span>{section.n}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
          <div className="policy-toc-cta">
            <p>
              Short on time? Read the <strong>5-point Customer Portal Summary</strong> instead.
            </p>
            <a href="#summary-header">Jump to summary ↓</a>
          </div>
        </nav>

        <SectionList sections={FULL_POLICY} />

        <div className="policy-divider" id="summary-header">
          <span>Customer portal</span>
        </div>

        <DocHeader
          icon="ti-notes"
          kicker="Customer portal"
          title="Customer Portal Policy Summary"
          desc="A shorter version of the same policy for a quick read in the customer portal."
        />

        <SectionList sections={SUMMARY} />

        <section className="policy-card policy-final">
          <div className="policy-final-copy">
            <h2>Need every legal detail?</h2>
            <p>Read the complete policy, including full terms, on our website.</p>
          </div>
          <a
            className="btn btn-primary"
            href={COMPLETE_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read complete policy on our website
            <i className="ti ti-arrow-right" aria-hidden />
          </a>
        </section>
      </div>

      <nav className="policy-rail" aria-label="On this page">
        <p className="policy-rail-title">On this page</p>
        <p className="policy-rail-group">Full policy</p>
        {RAIL_FULL.map((item) => (
          <a key={item.id} href={`#${item.id}`} className={activeId === item.id ? 'on' : undefined}>
            {item.label}
          </a>
        ))}
        <p className="policy-rail-group">Portal summary</p>
        {RAIL_SUMMARY.map((item) => (
          <a key={item.id} href={`#${item.id}`} className={activeId === item.id ? 'on' : undefined}>
            {item.label}
          </a>
        ))}
      </nav>

      <button
        type="button"
        className={`policy-top${showTop ? ' show' : ''}`}
        aria-label="Back to top"
        onClick={scrollToTop}
      >
        <i className="ti ti-arrow-up" aria-hidden />
      </button>
    </div>
  );
}
