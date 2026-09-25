import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTopbarLead } from '@/components/Shell';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EmbroideryFileCard } from '@/components/EmbroideryFileCard';
import { startMyOrderCheckout } from '@/lib/billing';
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
} from '@/lib/embroideryQuote';
import { openLinkedChat } from '@/lib/messaging';
import { acceptQuotation, myAttachmentUrl } from '@/lib/orders';
import { applyOrderChange } from '@/lib/queryCache';
import { dateShort, money, orderNumber } from '@/lib/format';
import type { Order } from '@/lib/types';
import '@/styles/embroidery-quote.css';

export function EmbroideryCustomerQuote({
  order,
  kind = 'embroidery',
}: {
  order: Order;
  kind?: 'embroidery' | 'cutting' | 'vector';
}) {
  const cutting = kind === 'cutting';
  const vector = kind === 'vector';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const prefs = asEmbroideryPrefs(order.preferences);
  const designs = embroideryDesigns(order.preferences, order.name);
  const designLabels = designs.map((design, index) =>
    designOptionLabel(index, design.name).replace(' - ', ' · '),
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
  const waiting = order.status === 'WAITING_FOR_QUOTATION' || order.status === 'CREATED';

  const [kept, setKept] = useState<string[] | null>(null);
  const [open, setOpen] = useState({ request: false, delivery: false, history: false });
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  useEffect(() => {
    setKept(null);
  }, [studio?.id]);

  const selected = useMemo(() => kept ?? lines.map((line) => line.id), [kept, lines]);
  const total = lines.filter((line) => selected.includes(line.id)).reduce((sum, line) => sum + lineTotal(line), 0);

  const claimed = new Set<string>();
  const designFiles = designs.map((design) => filesForDesign(design, attachments, claimed));

  const acceptMut = useMutation({
    mutationFn: () => acceptQuotation(order.id, selected),
    onSuccess: async (res) => {
      void applyOrderChange(qc, res.order);
      if (res.order.status === 'PENDING_PAYMENT') {
        setPayBusy(true);
        try {
          const pay = await startMyOrderCheckout(res.order.id);
          if (pay?.alreadyPaid) navigate(`/portal/orders/${res.order.id}`);
        } catch (e) {
          setError(getErrorMessage(e));
          setPayBusy(false);
        }
        return;
      }
      navigate(`/portal/orders/${order.id}`);
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

  const status = declined
    ? { text: 'Declined', ok: false }
    : canDecide
      ? { text: 'Ready for approval', ok: false }
      : waiting
        ? { text: 'Being prepared', ok: false }
        : { text: 'Quote in progress', ok: false };

  const history = [...quotations].sort((a, b) => a.version - b.version);
  const quoteNo = orderNumber(order.humanRef, order.id.slice(0, 6));
  const topbarLead = useMemo(
    () => (
      <nav className="ecd-crumb" aria-label="Breadcrumb">
        <Link to="/portal/quotes">Quotes</Link>
        <span aria-hidden="true">/</span>
        <b>{quoteNo}</b>
      </nav>
    ),
    [quoteNo],
  );
  useTopbarLead(topbarLead);

  return (
    <div className="ecd">
      <div className="ecd-head">
        <div>
          <h1>{order.name || designs[0]?.name || 'Embroidery quote'}</h1>
          <div className="ecd-meta">
            <span className={status.ok ? 'ecd-tag ok' : 'ecd-tag'}>{status.text}</span>
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
            <i className="ti ti-message" /> {chatMut.isPending ? 'Opening…' : 'Start Chat'}
          </button>
        </div>
      </div>

      {error && <div className="ead-banner">{error}</div>}

      <div className="ecd-sheet">
        <section className="ecd-sec">
          <div className="ecd-sec-h">
            <h2>Order summary</h2>
          </div>
          {lines.length === 0 && (
            <p className="ecd-wait">
              {declined
                ? order.rejectionReason || 'The team declined this request.'
                : 'The team is reviewing your files and details. Prices will show here when the quote is ready.'}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.title} className="ecd-group">
              <div className="ecd-group-name">{group.title}</div>
              <div className="ecd-quotes">
                {group.lines.map((line) => {
                  const on = selected.includes(line.id);
                  return (
                    <label key={line.id} className="ecd-line">
                      {canPick && (
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setKept((prev) => {
                              const current = prev ?? lines.map((item) => item.id);
                              return on ? current.filter((id) => id !== line.id) : [...current, line.id];
                            });
                          }}
                        />
                      )}
                      <span>{line.name}</span>
                      <b>{money(lineTotal(line))}</b>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {lines.length > 0 && <div className="ecd-perf" />}
          {lines.length > 0 && (
            <div className="ecd-foot">
              <div>
                <div className="ecd-total-label">{canPick ? 'Selected total' : 'Quoted total'}</div>
                <div className="ecd-total">{money(canPick ? total : studio?.amountCents ?? total)}</div>
              </div>
              {canDecide && (
                <div className="ecd-foot-acts">
                  <button type="button" className="ecd-btn" disabled={chatMut.isPending} onClick={() => chatMut.mutate()}>
                    <i className="ti ti-message" /> Contact us
                  </button>
                  <button
                    type="button"
                    className="ecd-btn pri"
                    disabled={acceptMut.isPending || payBusy || (canPick && selected.length === 0)}
                    onClick={() => acceptMut.mutate()}
                  >
                    {acceptMut.isPending || payBusy ? 'Please wait…' : 'Accept & Pay'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="ecd-sec">
          <div className={open.request ? 'ecd-sec-h open' : 'ecd-sec-h'}>
            <h2>Customer request</h2>
            <button
              type="button"
              className="ecd-disclose"
              aria-expanded={open.request}
              onClick={() => setOpen((prev) => ({ ...prev, request: !prev.request }))}
            >
              Details <i className="ti ti-chevron-down" />
            </button>
          </div>
          <div className={open.request ? 'ecd-body' : 'ecd-body collapsed'}>
            {designs.map((design, index) => {
              const files = designFiles[index] ?? { artwork: [], references: [] };
              const sizes = (design.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
              const hasRefs = files.references.length > 0;
              return (
                <div key={`${design.name ?? 'design'}-${index}`} className="ecd-design">
                  <h3>
                    <span className="ecd-num">{index + 1}</span>
                    {design.name?.trim() || `Design ${index + 1}`}
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
                            <td>{sizeDetail(size)}</td>
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
          <div className={open.delivery ? 'ecd-sec-h open' : 'ecd-sec-h'}>
            <h2>Delivery preferences</h2>
            <button
              type="button"
              className="ecd-disclose"
              aria-expanded={open.delivery}
              onClick={() => setOpen((prev) => ({ ...prev, delivery: !prev.delivery }))}
            >
              Details <i className="ti ti-chevron-down" />
            </button>
          </div>
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
          <div className={open.history ? 'ecd-sec-h open' : 'ecd-sec-h'}>
            <h2>Quote history</h2>
            <button
              type="button"
              className="ecd-disclose"
              aria-expanded={open.history}
              onClick={() => setOpen((prev) => ({ ...prev, history: !prev.history }))}
            >
              Details <i className="ti ti-chevron-down" />
            </button>
          </div>
          <div className={open.history ? 'ecd-body' : 'ecd-body collapsed'}>
            {history.length === 0 && <p className="ecd-wait">No quote has been sent yet.</p>}
            {history.length > 0 && (
              <div className="ecd-tl">
                {history.map((quote) => (
                  <div key={quote.id} className="ecd-tl-row">
                    <div>
                      <div style={{ fontWeight: 600 }}>{quoteHistoryLabel(quote, history)}</div>
                      <div className="ecd-wait" style={{ marginTop: 4 }}>{dateShort(quote.createdAt)}</div>
                    </div>
                    <div style={{ fontWeight: 600 }}>{money(quote.amountCents, quote.currency)}</div>
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
