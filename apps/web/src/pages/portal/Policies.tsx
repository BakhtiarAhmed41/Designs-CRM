const COMPLETE_POLICY_URL = 'https://lasvegasdesignsusa.com/refund-policy/';

type Block =
  | { type: 'p'; text: string }
  | { type: 'lead'; text: string }
  | { type: 'ul'; items: string[] };

const FULL_POLICY: Array<{ title: string; blocks: Block[] }> = [
  {
    title: '1 Cancellation before work starts',
    blocks: [
      {
        type: 'p',
        text: 'If you cancel your order before production has started, you may request either a full refund or store credit for a future order.',
      },
      {
        type: 'p',
        text: 'Once work has started, cancellation and refund options become limited because time has already been spent creating your custom file.',
      },
    ],
  },
  {
    title: '2 After work has started or files have been delivered',
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
        type: 'p',
        text: 'If there is a problem with the delivered file, we will first review the issue and provide reasonable revisions or corrections.',
      },
    ],
  },
  {
    title: '3 When a refund may be provided',
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
        type: 'p',
        text: 'If a confirmed problem is caused by our work and cannot be corrected, we will provide an appropriate refund.',
      },
      {
        type: 'p',
        text: 'Every request is reviewed individually based on the order details, files delivered, work completed, and evidence provided.',
      },
    ],
  },
  {
    title: '4 Store credit and future-order compensation',
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
      { type: 'lead', text: 'Store credit:' },
      {
        type: 'ul',
        items: [
          "Is linked to the customer's account.",
          'Can be applied to a future order.',
          'Is not transferable to another customer.',
          'Cannot normally be exchanged for cash after it has been accepted.',
        ],
      },
      {
        type: 'p',
        text: 'Future-order discounts and complimentary services are offered at our discretion and do not automatically apply to every refund request.',
      },
    ],
  },
  {
    title: '5 When refunds are not applicable',
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
    title: '6 Production-related limitations',
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
        type: 'p',
        text: 'We will still try to help identify the issue and recommend possible adjustments whenever reasonably possible.',
      },
    ],
  },
  {
    title: '7 Sample stitch-out and file testing',
    blocks: [
      {
        type: 'p',
        text: 'If an embroidery problem continues after reasonable troubleshooting, we may recommend or arrange a sample stitch-out.',
      },
      { type: 'p', text: 'The customer may be asked to provide:' },
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
        type: 'p',
        text: 'If a sample stitch-out confirms that the problem was caused by our digitized file, we will correct the file. If the confirmed issue cannot be corrected, we will refund the applicable payment.',
      },
      {
        type: 'p',
        text: 'If the sample stitch-out runs correctly and shows that the file is not the cause of the problem, any agreed sample stitch-out or production-testing charge will remain payable. Any testing charge will be explained and approved before testing begins.',
      },
    ],
  },
  {
    title: '8 Free minor revisions',
    blocks: [
      {
        type: 'p',
        text: 'Minor revisions that remain within the original instructions are normally provided free of charge.',
      },
      { type: 'p', text: 'Free minor revisions may include:' },
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
        type: 'p',
        text: 'Customers may request the available file formats they need for the same completed design at no additional charge.',
      },
    ],
  },
  {
    title: '9 Major revisions and additional charges',
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
        type: 'p',
        text: "We will explain any additional charge and obtain the customer's approval before beginning the extra work.",
      },
    ],
  },
  {
    title: '10 Customer responsibilities',
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
        type: 'p',
        text: 'Changes caused by missing, incorrect, or incomplete information may require an additional charge. Customers should review previews carefully and test delivered files before beginning full production.',
      },
    ],
  },
  {
    title: '11 Chargebacks and disputes',
    blocks: [
      {
        type: 'p',
        text: 'Please contact us before opening a payment dispute or chargeback. Most problems can be resolved through troubleshooting, file corrections, revisions, store credit, or another mutually agreed solution.',
      },
      {
        type: 'p',
        text: 'If a chargeback is opened while we are actively reviewing or correcting an issue, work on the order may be paused until the dispute is resolved.',
      },
    ],
  },
  {
    title: '12 Contact us',
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
      {
        type: 'p',
        text: 'Email: sales@lasvegasdesignsusa.com',
      },
      {
        type: 'p',
        text: 'We will review the information and respond with the appropriate next step.',
      },
    ],
  },
];

const SUMMARY: Array<{ title: string; intro?: string; items?: string[]; text?: string }> = [
  {
    title: 'Refund eligibility',
    intro: 'You may cancel for a full refund before work starts.',
    items: [
      'Once work starts or digital files are delivered, refunds are limited.',
      'If a confirmed issue from our side cannot be corrected, we will provide an appropriate refund.',
    ],
  },
  {
    title: 'Store credit and compensation',
    intro: 'Some cases may be resolved with credit instead of a refund.',
    items: [
      'Credit can be carried forward to your next order.',
      'We may also offer a future-order discount or complimentary adjustment.',
    ],
  },
  {
    title: 'Free revisions',
    intro: 'Minor changes within the original request are usually free.',
    items: [
      'Simple color and thread-color changes.',
      'Additional available file formats for the same design.',
      'Size adjustments up to approximately 20 percent, where technically possible.',
      'Major redesigns or artwork changes may cost extra.',
    ],
  },
  {
    title: 'Machine and production issues',
    intro: 'Digital-file results also depend on your machine, materials, and settings.',
    items: [
      'Machine settings, tension, fabric, stabilizer, and hooping are outside our control.',
      'If a problem continues, we may request photographs, videos, or a sample stitch-out.',
      'If testing confirms our file caused the issue, we will correct it or provide an appropriate refund.',
    ],
  },
  {
    title: 'Before opening a dispute',
    text: 'Please message us with your order number and details. Most concerns can be resolved through troubleshooting, revisions, store credit, or another agreed solution.',
  },
];

function splitTitle(title: string) {
  const match = title.match(/^(\d+)\s+(.+)$/);
  return {
    n: (match?.[1] ?? '').padStart(2, '0'),
    heading: match?.[2] ?? title,
  };
}

function PolicyBlocks({
  id,
  blocks,
}: {
  id: string;
  blocks: Block[];
}) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={`${id}-ul-${i}`} className="policy-list">
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'lead') {
          return (
            <p key={`${id}-lead-${i}`} className="policy-lead">
              {block.text}
            </p>
          );
        }
        return <p key={`${id}-p-${i}`}>{block.text}</p>;
      })}
    </>
  );
}

export function PortalPolicies() {
  return (
    <div className="policy-page">
      <header className="policy-hero">
        <div className="policy-hero-icon" aria-hidden>
          <i className="ti ti-scale" />
        </div>
        <div className="policy-hero-copy">
          <p className="policy-kicker">Las Vegas Designs USA · Policies</p>
          <h1>Refund Store Credit and Revision Policy</h1>
          <p className="policy-sub">
            This policy explains when refunds, store credit, revisions, file testing, and additional
            charges may apply to custom digital services. Our first priority is to correct any
            confirmed file issue and deliver a usable result.
          </p>
        </div>
      </header>

      <nav className="policy-toc" aria-label="On this page">
        <p className="policy-toc-label">On this page</p>
        <ol>
          {FULL_POLICY.map((section) => {
            const { n, heading } = splitTitle(section.title);
            return (
              <li key={n}>
                <a href={`#policy-${n}`}>
                  <span>{n}</span>
                  {heading}
                </a>
              </li>
            );
          })}
          <li>
            <a href="#policy-summary">
              <span>S</span>
              Customer Portal Policy Summary
            </a>
          </li>
        </ol>
      </nav>

      <article className="policy-doc">
        {FULL_POLICY.map((section) => {
          const { n, heading } = splitTitle(section.title);
          return (
            <section key={n} id={`policy-${n}`} className="policy-section">
              <div className="policy-section-head">
                <span className="policy-num">{n}</span>
                <h2>{heading}</h2>
              </div>
              <div className="policy-section-body">
                <PolicyBlocks id={n} blocks={section.blocks} />
              </div>
            </section>
          );
        })}
      </article>

      <header className="policy-hero policy-hero-next" id="policy-summary">
        <div className="policy-hero-icon" aria-hidden>
          <i className="ti ti-notes" />
        </div>
        <div className="policy-hero-copy">
          <p className="policy-kicker">Customer portal</p>
          <h1>Customer Portal Policy Summary</h1>
          <p className="policy-sub">
            A shorter version of the same policy for a quick read in the customer portal.
          </p>
        </div>
      </header>

      <article className="policy-doc">
        {SUMMARY.map((section, i) => {
          const n = String(i + 1).padStart(2, '0');
          const blocks: Block[] = [
            ...(section.intro ? [{ type: 'p' as const, text: section.intro }] : []),
            ...(section.items ? [{ type: 'ul' as const, items: section.items }] : []),
            ...(section.text ? [{ type: 'p' as const, text: section.text }] : []),
          ];
          return (
            <section key={section.title} id={`summary-${n}`} className="policy-section">
              <div className="policy-section-head">
                <span className="policy-num">{n}</span>
                <h2>{section.title}</h2>
              </div>
              <div className="policy-section-body">
                <PolicyBlocks id={`s${n}`} blocks={blocks} />
              </div>
            </section>
          );
        })}
      </article>

      <div className="policy-actions">
        <a
          className="btn btn-primary"
          href={COMPLETE_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read complete policy on our website
          <i className="ti ti-arrow-right" aria-hidden />
        </a>
      </div>
    </div>
  );
}
