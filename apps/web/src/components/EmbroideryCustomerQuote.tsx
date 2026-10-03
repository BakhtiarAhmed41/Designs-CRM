import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTopbarLead } from '@/components/Shell';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DesignNameTitle, DetailsSectionHead } from '@/components/DesignNameTitle';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { listMyInvoices, openInvoicePrint, goToOrderCheckout } from '@/lib/billing';
import { getErrorMessage } from '@/lib/api';
import { isAdminRecounter, isStaffCreatedOrder, lineTotal, quoteHistoryLabel, studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import {
  asEmbroideryPrefs,
  backgroundLabel,
  colorModeLabel,
  designOptionLabel,
  embroideryDesigns,
  filesForDesign,
  groupQuoteLines,
  resolutionLabel,
  sizeDetail,
  turnaroundLabel,
  type EmbAttachment,
  type EmbDesign,
  type EmbSize,
} from '@/lib/embroideryQuote';
import type { QuotationLine } from '@/lib/designs';
import { openLinkedChat } from '@/lib/messaging';
import { acceptQuotation, myAttachmentUrl } from '@/lib/orders';
import { applyOrderChange } from '@/lib/queryCache';
import { dateShort, money, orderNumber, orderSlug } from '@/lib/format';
import { quoteJourneyPhase } from '@/lib/quoteJourney';
import type { Order } from '@/lib/types';
import { QuoteJourney, QuotePricingEmpty } from '@/components/QuoteJourney';
import '@/styles/embroidery-quote.css';

function serviceForDesign(kind: 'embroidery' | 'cutting' | 'vector', design?: EmbDesign) {
  const picked = design?.service?.trim();
  if (picked) return picked;
  if (kind === 'cutting') return 'Cutting & Engraving';
  if (kind === 'vector') return 'Vector & Print';
  return 'Embroidery Digitizing';
}

function sizePlacement(size: EmbSize) {
  const detail = size.detail?.trim() || '';
  const measured = [size.w, size.h].filter(Boolean).join(' × ');
  const sizeText = detail || (measured ? `${measured}${size.unit ? ` ${size.unit}` : ''}` : '');
  const place = size.placement?.trim() || '';
  if (sizeText && place) return `${sizeText} · ${place}`;
  return sizeText || place;
}

function pricedSizes(design?: EmbDesign) {
  return (design?.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
}

function lineSizeLabel(line: QuotationLine, design: EmbDesign | undefined, index: number) {
  const fromDesign = pricedSizes(design)[index];
  const fromRequest = fromDesign ? sizePlacement(fromDesign) : '';
  if (fromRequest) return fromRequest;
  const fromQuote = (line.sizes ?? []).map((size) => size.label?.trim()).filter(Boolean);
  if (fromQuote.length) return fromQuote.join(' · ');
  return '—';
}

function selectionCaption(itemCount: number, designCount: number, picking: boolean) {
  if (picking && itemCount === 0) return '0 items selected';
  const items = itemCount === 1 ? '1 item' : `${itemCount} items`;
  const selected = picking ? ' selected' : '';
  if (designCount <= 1) return `${items}${selected} for 1 design`;
  return `${items}${selected} across ${designCount} designs`;
}

export function EmbroideryCustomerQuote({
  order,
  kind = 'embroidery',
  notice,
}: {
  order: Order;
  kind?: 'embroidery' | 'cutting' | 'vector';
  notice?: string | null;
}) {
  const cutting = kind === 'cutting';
  const vector = kind === 'vector';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const prefs = asEmbroideryPrefs(order.preferences);
  const designs = embroideryDesigns(order.preferences, order.name);
  const designLabels = designs.map((design, index) =>
    designOptionLabel(index, design.name),
  );
  const attachments: EmbAttachment[] = (order.attachments ?? []).map((file) => ({
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    previewUrl: file.previewUrl,
  }));
  const quotations = (order.quotations ?? []) as QuoteWithLines[];
  const studio = studioQuotation(quotations);
  const lines = studio?.lines ?? [];
  const groups = groupQuoteLines(lines, designLabels);
  const canDecide = order.status === 'QUOTATION_PROVIDED';
  const adminRecounter = isAdminRecounter(quotations);
  const canPick = canDecide && !adminRecounter;
  const declined = order.status === 'REJECTED' || order.status === 'CLIENT_REJECTED_QUOTATION';

  const [kept, setKept] = useState<string[] | null>(null);
  const [open, setOpen] = useState({ request: false, delivery: false, history: false });
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  useEffect(() => {
    setKept(null);
  }, [studio?.id]);

  const selected = useMemo(() => kept ?? lines.map((line) => line.id), [kept, lines]);
  const total = lines.filter((line) => selected.includes(line.id)).reduce((sum, line) => sum + lineTotal(line), 0);

  const claimed = new Set<string>();
  const designFiles = designs.map((design) => filesForDesign(design, attachments, claimed));

  const quotePath = `/portal/quotes/${orderSlug(order.humanRef, order.id)}`;
  const orderPath = `/portal/orders/${orderSlug(order.humanRef, order.id)}`;

  function payQuote() {
    setPayBusy(true);
    setError(null);
    goToOrderCheckout(order.id, quotePath);
  }

  const acceptMut = useMutation({
    mutationFn: () => acceptQuotation(order.id, selected),
    onSuccess: async (res) => {
      void applyOrderChange(qc, res.order);
      if (res.order.status !== 'PENDING_PAYMENT') return;
      setPayBusy(true);
      goToOrderCheckout(res.order.id, quotePath);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const chatMut = useMutation({
    mutationFn: () =>
      openLinkedChat({
        orderId: order.id,
        chatType: 'QUOTE',
        subject: order.humanRef ? `Quotation ${orderNumber(order.humanRef)} Chat` : 'Quotation Chat',
      }),
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (e) => setError(getErrorMessage(e)),
  });

  async function openInvoice() {
    setInvoiceBusy(true);
    setError(null);
    try {
      const { invoices } = await listMyInvoices();
      const matches = invoices.filter(
        (item) => item.orderId === order.id || item.linkedOrderIds?.includes(order.id),
      );
      const invoice = matches.find((item) => item.status === 'PAID') ?? matches[0];
      if (!invoice) {
        setError('No invoice for this order yet.');
        return;
      }
      await openInvoicePrint(invoice.id);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setInvoiceBusy(false);
    }
  }

  const phase = quoteJourneyPhase(order);
  const paid = phase === 'paid';
  const owesPayment =
    !paid &&
    !declined &&
    (phase === 'pay' || order.status === 'PENDING_PAYMENT' || order.paymentStatus === 'AWAITING');
  const showSelect = !paid && !declined;
  const counterPending = order.status === 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL';
  const status =
    phase === 'paid'
      ? { text: 'Paid', cls: 'ecd-tag ok soft' }
      : phase === 'accepted'
        ? { text: 'Confirmed', cls: 'ecd-tag ok soft' }
        : phase === 'pay'
          ? { text: 'Awaiting payment', cls: 'ecd-tag' }
          : phase === 'review'
            ? {
                text: counterPending ? 'Quote in progress' : 'Ready for review',
                cls: counterPending ? 'ecd-tag' : 'ecd-tag review soft',
              }
            : declined
              ? { text: 'Declined', cls: 'ecd-tag' }
              : { text: 'Quote in Progress', cls: 'ecd-tag' };
  const journeyCopy =
    order.needsCustomerInfo && phase === 'preparing'
      ? {
          title: "We're preparing your quote",
          subtitle: 'We need a few more details from you before we can finish the price.',
        }
      : counterPending
        ? {
            title: "We're reviewing your counter",
            subtitle: "We'll send an updated quote once we've looked at your offer.",
          }
        : undefined;

  const history = [...quotations].sort((a, b) => a.version - b.version);
  const quoteNo = orderNumber(order.humanRef, order.id.slice(0, 6));
  const serviceName = vector ? 'Vector' : cutting ? 'Cutting' : 'Embroidery';
  const topbarLead = useMemo(
    () => (
      <nav className="ecd-crumb" aria-label="Breadcrumb">
        <Link to="/portal/quotes">Quote</Link>
        <span aria-hidden="true">/</span>
        <span>{serviceName}</span>
        <span aria-hidden="true">/</span>
        <b>{quoteNo}</b>
      </nav>
    ),
    [quoteNo, serviceName],
  );
  useTopbarLead(topbarLead);

  return (
    <div className="ecd">
      <div className="ecd-head">
        <div className="ecd-head-copy">
          <DesignNameTitle
            names={designs.map((design, index) => designOptionLabel(index, design.name))}
            fallback={order.name?.trim() || 'Embroidery quote'}
          />
          <div className="ecd-meta">
            <span className={status.cls}>{status.text}</span>
            <span className="ecd-sep" />
            <span>Requested {dateShort(order.createdAt)}</span>
            {isStaffCreatedOrder(order) && (
              <>
                <span className="ecd-sep" />
                <span>Created by the team</span>
              </>
            )}
          </div>
        </div>
        <div className="ecd-acts">
          <button type="button" className="ecd-btn pri" disabled={chatMut.isPending} onClick={() => chatMut.mutate()}>
            <i className="ti ti-message" /> {chatMut.isPending ? 'Opening…' : 'Need help?'}
          </button>
        </div>
      </div>

      {(error || notice) && <div className="ead-banner">{error || notice}</div>}

      {phase !== 'closed' && (
        <QuoteJourney
          phase={phase}
          orderTo={orderPath}
          canChoose={canPick}
          paying={payBusy}
          onPay={phase === 'pay' ? () => void payQuote() : undefined}
          title={journeyCopy?.title}
          subtitle={journeyCopy?.subtitle}
        />
      )}

      <div className="ecd-sheet">
        <section className="ecd-sec qj-price">
          <div className="ecd-sec-h">
            <div>
              <h2>Quote pricing</h2>
              {lines.length > 0 && (
                <p className="qj-price-lead">
                  {paid
                    ? 'Items included in your paid order.'
                    : canPick
                      ? "Select the items you'd like to order."
                      : 'Items quoted for this request.'}
                </p>
              )}
            </div>
          </div>
          {lines.length === 0 && (
            <QuotePricingEmpty
              declined={declined}
              settled={phase !== 'preparing' && phase !== 'closed'}
              reason={order.rejectionReason}
            />
          )}
          {declined && lines.length > 0 && (
            <p className="ecd-wait">{order.rejectionReason || 'The team declined this request.'}</p>
          )}
          {groups.map((group) => {
            const design = designs[designLabels.indexOf(group.title)];
            const serviceName = serviceForDesign(kind, design);
            return (
              <div key={group.title} className="ecd-group">
                <div className="ecd-label">Design name</div>
                <div className="ecd-group-name">{group.title}</div>
                <div className={`ecd-quotes${showSelect ? '' : ' no-select'}`}>
                  <div className="qj-price-head">
                    {showSelect && <span>Select</span>}
                    <span>Quoted item</span>
                    <span className="qj-col-place">Size & placement</span>
                    <span className="qj-col-price">Price</span>
                  </div>
                  {group.lines.map((line, index) => {
                    const on = selected.includes(line.id);
                    const included = line.clientDecision !== 'DROPPED';
                    const Row = canPick ? 'label' : 'div';
                    return (
                      <Row key={line.id} className="ecd-line">
                        {showSelect && (
                          <input
                            type="checkbox"
                            checked={canPick ? on : included}
                            disabled={!canPick}
                            onChange={() => {
                              if (!canPick) return;
                              setKept((prev) => {
                                const current = prev ?? lines.map((item) => item.id);
                                return on ? current.filter((id) => id !== line.id) : [...current, line.id];
                              });
                            }}
                          />
                        )}
                        <span>{serviceName}</span>
                        <span className="qj-col-place">{lineSizeLabel(line, design, index)}</span>
                        <span className="qj-col-price">{money(lineTotal(line))}</span>
                      </Row>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {lines.length > 0 && (
            <div className={`ecd-foot${paid ? ' is-paid' : ''}`}>
              <div>
                <div className="ecd-total-label">{paid ? 'Amount paid' : canPick ? 'Selected total' : 'Quoted total'}</div>
                {paid ? (
                  <div className="ecd-paid-row">
                    <div className="ecd-total">{money(studio?.amountCents ?? total)}</div>
                    <span className="ecd-paid-flag">
                      <i className="ti ti-circle-check" /> Payment received
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="ecd-total">{money(canPick ? total : studio?.amountCents ?? total)}</div>
                    <div className="ecd-total-note">
                      {selectionCaption(
                        canPick ? selected.length : lines.length,
                        groups.filter((group) =>
                          group.lines.some((line) => !canPick || selected.includes(line.id)),
                        ).length,
                        canPick,
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="ecd-foot-acts">
                {paid ? (
                  <button
                    type="button"
                    className="ecd-btn ecd-btn-invoice"
                    disabled={invoiceBusy}
                    onClick={() => void openInvoice()}
                  >
                    {invoiceBusy ? 'Opening…' : 'View invoice'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="ecd-btn" disabled={chatMut.isPending} onClick={() => chatMut.mutate()}>
                      Need help?
                    </button>
                    {canDecide ? (
                      <button
                        type="button"
                        className="ecd-btn pri"
                        disabled={acceptMut.isPending || payBusy || (canPick && selected.length === 0)}
                        onClick={() => acceptMut.mutate()}
                      >
                        {acceptMut.isPending || payBusy ? 'Please wait…' : 'Accept & Pay'}
                      </button>
                    ) : (
                      owesPayment && (
                        <button
                          type="button"
                          className="ecd-btn pri"
                          disabled={payBusy}
                          onClick={() => void payQuote()}
                        >
                          {payBusy ? 'Opening checkout…' : 'Pay now'}
                        </button>
                      )
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="ecd-sheet ecd-summary">
        <h2 className="ecd-summary-title">Quote summary</h2>
        <section className="ecd-sec">
          <DetailsSectionHead
            title="Design request"
            description={
              vector
                ? 'Artwork, instructions and specifications'
                : 'Artwork, instructions and requested sizes'
            }
            open={open.request}
            onToggle={() => setOpen((prev) => ({ ...prev, request: !prev.request }))}
          />
          <div className={open.request ? 'ecd-body' : 'ecd-body collapsed'}>
            {designs.map((design, index) => {
              const files = designFiles[index] ?? { artwork: [], references: [] };
              const sizes = (design.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
              const hasRefs = files.references.length > 0;
              return (
                <div key={`${design.name ?? 'design'}-${index}`} className="ecd-design">
                  <h3>
                    <span className="ecd-num">{index + 1}.</span>
                    {designOptionLabel(index, design.name)}
                  </h3>
                  <div className={hasRefs ? 'ecd-assets' : undefined}>
                    <div>
                      <div className="ecd-label">Artwork</div>
                      <div className="ecd-swatches">
                        {files.artwork.map((file) => (
                          <EmbroideryFileCard
                            key={file.id}
                            name={file.name}
                            mimeType={file.mimeType}
                            previewUrl={file.previewUrl}
                            signedUrlPath={myAttachmentUrl(order.id, file.id)}
                            label="Main Artwork"
                            variant="swatch"
                            onError={setError}
                          />
                        ))}
                        {files.artwork.length === 0 && <div className="ecd-wait">No artwork uploaded.</div>}
                      </div>
                    </div>
                    {hasRefs && (
                      <div>
                        <div className="ecd-label">Reference images</div>
                        <div className="ecd-swatches">
                          {files.references.map((file) => (
                            <EmbroideryFileCard
                              key={file.id}
                              name={file.name}
                              mimeType={file.mimeType}
                              previewUrl={file.previewUrl}
                              signedUrlPath={myAttachmentUrl(order.id, file.id)}
                              label="Reference"
                              variant="swatch"
                              onError={setError}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {vector ? (
                    <>
                      <div className="ecd-label">Artwork preferences</div>
                      <div className="ecd-spec">
                        <dl className="ecd-pref">
                          <div>
                            <dt>Background</dt>
                            <dd>{backgroundLabel(design.background)}</dd>
                          </div>
                          <div>
                            <dt>Color Mode</dt>
                            <dd>{colorModeLabel(design.colors)}</dd>
                          </div>
                          <div>
                            <dt>Resolution</dt>
                            <dd>{resolutionLabel(design.dpi300)}</dd>
                          </div>
                        </dl>
                        {design.notes?.trim() && (
                          <>
                            <span className="ecd-note-kicker">Customer's note</span>
                            <p className="ecd-note">{design.notes.trim()}</p>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                  <>
                  <div className="ecd-label">Sizes and placement</div>
                  <div className="ecd-spec">
                    <table className={cutting ? 'ecd-table ecd-table-cut' : 'ecd-table'}>
                      <thead>
                        <tr>
                          <th style={{ width: cutting ? '65%' : '40%' }}>Size or Placement</th>
                          {!cutting && <th>Embroidered on</th>}
                          <th><span className="ecd-prop">Proportional</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sizes.map((size, sizeIndex) => (
                          <tr key={`${size.detail ?? 'size'}-${sizeIndex}`}>
                            <td>
                              <span className="ecd-size-n">{sizeIndex + 1}</span>
                              {sizeDetail(size)}
                            </td>
                            {!cutting && <td>{size.placement || '—'}</td>}
                            <td>
                              <span className="ecd-prop">
                                <span className="ecd-prop-sizer" aria-hidden="true">
                                  Proportional
                                </span>
                                {size.keepProportional === false ? (
                                  <span>No</span>
                                ) : (
                                  <span className="ecd-yes">
                                    <i className="ti ti-check" /> Yes
                                  </span>
                                )}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {sizes.length === 0 && (
                          <tr>
                            <td colSpan={cutting ? 2 : 3}>No sizes added.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {design.notes?.trim() && (
                      <>
                        <span className="ecd-note-kicker">Customer's note</span>
                        <p className="ecd-note">{design.notes.trim()}</p>
                      </>
                    )}
                  </div>
                  </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="ecd-sec">
          <DetailsSectionHead
            title="Delivery preferences"
            description="Formats and delivery choices"
            open={open.delivery}
            onToggle={() => setOpen((prev) => ({ ...prev, delivery: !prev.delivery }))}
          />
          <div className={open.delivery ? 'ecd-body' : 'ecd-body collapsed'}>
            <div className="ecd-pref">
              <div>
                <dt>Requested file formats</dt>
                {(prefs?.formats ?? []).length === 0 && <dd>None selected</dd>}
                {(prefs?.formats ?? []).length > 0 && (
                  <div className="ecd-chips">
                    {(prefs?.formats ?? []).map((fmt) => (
                      <span key={fmt} className="ecd-chip">{fmt}</span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <dt>Preview files included</dt>
                <dd>{cutting ? 'Proof preview' : 'PDF and PNG'}</dd>
              </div>
              <div>
                <dt>Turnaround requested</dt>
                <dd>{turnaroundLabel(prefs?.turnaround).replace(' · ', ', ')}</dd>
              </div>
            </div>
          </div>
        </section>

        <section className="ecd-sec">
          <DetailsSectionHead
            title="Quote history"
            description="Previous quotes and price revisions"
            open={open.history}
            onToggle={() => setOpen((prev) => ({ ...prev, history: !prev.history }))}
          />
          <div className={open.history ? 'ecd-body' : 'ecd-body collapsed'}>
            {history.length === 0 && <p className="ecd-wait">No quote has been sent yet.</p>}
            {history.length > 0 && (
              <div className="ecd-tl">
                {history.map((quote) => (
                  <div key={quote.id} className="ecd-tl-row">
                    <div>
                      <div className="ecd-tl-name">{quoteHistoryLabel(quote, history)}</div>
                      <div className="ecd-tl-sub">{dateShort(quote.createdAt)}</div>
                    </div>
                    <div className="ecd-tl-price">{money(quote.amountCents, quote.currency)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
