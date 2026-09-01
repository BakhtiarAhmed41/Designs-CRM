import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  adminCreateOrder,
  adminUploadAttachments,
  createOrder,
  getQuoteDraft,
  saveQuoteDraft,
  uploadAttachments,
} from '@/lib/orders';
import { getErrorMessage } from '@/lib/api';
import { getCustomer, getMyCustomer } from '@/lib/customers';
import { money } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { invalidateWorkCaches } from '@/lib/queryCache';

type PriceLine = { name: string; note: string; price: string };

function emptyPriceLine(): PriceLine {
  return { name: '', note: '', price: '' };
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function cloneFiles(files: File[]): File[] {
  return files.map((f) => new File([f], f.name, { type: f.type, lastModified: f.lastModified }));
}

export type AdminFormContext = {
  customerId: string;
  customerName: string;
  type: 'ORDER' | 'QUOTE_REQUEST';
};

type ServiceKey = 'embroidery' | 'svg' | 'vector' | 'laser';

type Collected = {
  mode: string;
  designName: string;
  instructions: string;
  size: string | null;
  turnaround: string | null;
  formats: string[];
  designs: Array<Record<string, unknown>>;
  fields: Array<{ label: string; value: string }>;
  advanced: Record<string, boolean>;
  formVersion: number;
};

const SERVICES: Array<{
  key: ServiceKey;
  serviceType: string;
  label: string;
  desc: string;
  icon: string;
  mar?: boolean;
}> = [
  {
    key: 'embroidery',
    serviceType: 'EMBROIDERY',
    label: 'Embroidery digitizing',
    desc: 'Turn your logo into a stitch file. DST, PES and more.',
    icon: 'ti-needle-thread',
  },
  {
    key: 'svg',
    serviceType: 'SVG',
    label: 'SVG & cut files',
    desc: 'Vinyl, Cricut, engraving and layered cut files.',
    icon: 'ti-vector-triangle',
    mar: true,
  },
  {
    key: 'vector',
    serviceType: 'VECTOR',
    label: 'Vector & print files',
    desc: 'Logo redraws and print-ready color separations.',
    icon: 'ti-vector-bezier',
  },
  {
    key: 'laser',
    serviceType: 'CNC_LASER',
    label: 'CNC & laser cut files',
    desc: 'Cutting, engraving, stencils and plasma files.',
    icon: 'ti-router',
    mar: true,
  },
];

declare global {
  interface Window {
    LVD_COLLECT?: () => Collected;
    LVD_GET_FILES?: () => File[];
  }
}

export function QuoteBuilderModal({
  open,
  onClose,
  onSubmitted,
  initialService,
  adminFor,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted?: (orderId: string) => void;
  initialService?: string | null;
  adminFor?: AdminFormContext | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [service, setService] = useState<(typeof SERVICES)[number] | null>(null);
  const isAdmin = Boolean(adminFor);
  const isDirectOrder = adminFor?.type === 'ORDER';
  const kindLabel = adminFor?.type === 'ORDER' ? 'order' : 'quote';
  const fallbackName =
    adminFor?.customerName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'Your account';
  const [accountName, setAccountName] = useState(fallbackName);
  const [customerPrefs, setCustomerPrefs] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [priceStep, setPriceStep] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<{
    serviceType: string;
    name: string;
    subCategory: string;
    instructions: string | null;
    size: string | null;
    turnaroundKey: string | null;
    preferences: Record<string, unknown>;
  } | null>(null);
  const [formFiles, setFormFiles] = useState<File[]>([]);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [priceLines, setPriceLines] = useState<PriceLine[]>([emptyPriceLine()]);

  const resetPicker = useCallback(() => {
    setService(null);
    setError(null);
    setPriceStep(false);
    setPendingPayload(null);
    setFormFiles([]);
    setExtraFiles([]);
    setPriceLines([emptyPriceLine()]);
    if (iframeRef.current) iframeRef.current.src = 'about:blank';
  }, []);

  useEffect(() => {
    if (!open) {
      resetPicker();
      return;
    }
    setAccountName(fallbackName);
    if (initialService) {
      const found = SERVICES.find((s) => s.key === initialService);
      if (found) setService(found);
    }
    const loadPrefs = adminFor
      ? getCustomer(adminFor.customerId).then((res) => {
          setAccountName(res.customer?.name?.trim() || adminFor.customerName || fallbackName);
          const prefs = res.customer?.preferences;
          setCustomerPrefs(
            prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>) : null,
          );
        })
      : getMyCustomer().then((res) => {
          setAccountName(res.customer?.name?.trim() || fallbackName);
          const prefs = res.customer?.preferences;
          setCustomerPrefs(
            prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>) : null,
          );
        });
    void loadPrefs.catch(() => {
      setAccountName(fallbackName);
      setCustomerPrefs(null);
    });
  }, [open, resetPicker, fallbackName, initialService, adminFor?.customerId, adminFor?.customerName, adminFor?.type]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const submitFromIframe = useCallback(async () => {
    if (!service) return;
    setError(null);
    setBusy(true);
    try {
      const win = iframeRef.current?.contentWindow;
      const collected: Collected =
        win?.LVD_COLLECT?.() ??
        ({
          mode: 'q',
          designName: 'New design request',
          instructions: '',
          size: null,
          turnaround: null,
          formats: [],
          designs: [],
          fields: [],
          advanced: {},
          formVersion: 1,
        } as Collected);
      const files = win?.LVD_GET_FILES?.() ?? [];

      const payload = {
        serviceType: service.serviceType,
        name: collected.designName,
        subCategory: collected.designName,
        instructions: collected.instructions || null,
        size: collected.size,
        turnaroundKey: collected.turnaround,
        preferences: {
          service: service.key,
          serviceType: service.serviceType,
          mode: collected.mode,
          turnaround: collected.turnaround,
          formats: collected.formats,
          designs: collected.designs,
          fields: collected.fields,
          advanced: collected.advanced,
          formVersion: collected.formVersion,
        },
      };

      if (adminFor) {
        setPendingPayload(payload);
        setFormFiles(cloneFiles(files));
        setExtraFiles([]);
        setPriceLines([emptyPriceLine()]);
        setPriceStep(true);
        setBusy(false);
        return;
      }

      const { order } = await createOrder({
        type: 'QUOTE_REQUEST',
        ...payload,
      });

      if (files.length > 0) {
        await uploadAttachments(order.id, files);
      }

      await invalidateWorkCaches(qc);
      setToast('Quote submitted. Added to your Quotes as “Being priced.”');
      onSubmitted?.(order.id);
      window.setTimeout(() => onClose(), 500);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [service, qc, onClose, onSubmitted, adminFor]);

  const priceTotalCents = priceLines.reduce((sum, line) => {
    const cents = dollarsToCents(line.price);
    return sum + (cents ?? 0);
  }, 0);

  const finishAdminPriced = useCallback(async () => {
    if (!adminFor || !pendingPayload) return;
    const named = priceLines.filter((l) => l.name.trim());
    if (named.length === 0) {
      setError('Add at least one line item.');
      return;
    }
    const missingPrice = named.find((l) => dollarsToCents(l.price) == null);
    if (missingPrice) {
      setError('Add a price for each line item.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { order } = await adminCreateOrder({
        type: adminFor.type,
        customerId: adminFor.customerId,
        customerName: adminFor.customerName,
        source: 'PORTAL',
        channel: 'ADMIN',
        ...pendingPayload,
        priceCents: priceTotalCents,
        lines: named.map((l) => ({
          name: l.name.trim(),
          note: l.note.trim() || null,
          priceCents: dollarsToCents(l.price) ?? 0,
        })),
      });
      const files = [...formFiles, ...extraFiles];
      if (files.length > 0) {
        await adminUploadAttachments(order.id, files);
      }
      await invalidateWorkCaches(qc);
      setToast(
        adminFor.type === 'ORDER'
          ? 'Order created as accepted and in progress.'
          : 'Quote sent to the customer.',
      );
      onSubmitted?.(order.id);
      window.setTimeout(() => onClose(), 500);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [
    adminFor,
    pendingPayload,
    priceLines,
    priceTotalCents,
    formFiles,
    extraFiles,
    qc,
    onClose,
    onSubmitted,
  ]);

  useEffect(() => {
    if (!open) return;
    function onMsg(ev: MessageEvent) {
      const data = ev.data as {
        type?: string;
        restoredDraft?: boolean;
      } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'lvd-form-ready') {
        const win = iframeRef.current?.contentWindow;
        if (win) {
          win.postMessage(
            {
              type: 'lvd-set-context',
              role: isAdmin ? 'admin' : 'customer',
              kind: isDirectOrder ? 'order' : 'quote',
            },
            '*',
          );
        }
        if (win && customerPrefs) {
          win.postMessage({ type: 'lvd-apply-prefs', prefs: customerPrefs }, '*');
        }
        if (service && !isAdmin) {
          void getQuoteDraft(service.key).then((res) => {
            if (res.draft && win) {
              win.postMessage({ type: 'lvd-restore-draft', draft: res.draft.payload }, '*');
              setToast('Restored your saved draft.');
            }
          });
        }
      }
      if (data.type === 'lvd-quote-submit') {
        void submitFromIframe();
      }
      if (!isAdmin && (data.type === 'lvd-quote-draft' || data.type === 'lvd-draft-saved')) {
        const win = iframeRef.current?.contentWindow;
        const collected = win?.LVD_COLLECT?.();
        if (service && collected) {
          void saveQuoteDraft(service.key, collected)
            .then(() => {
              setToast('Draft saved. You’ll see it on Quotes.');
              void qc.invalidateQueries({ queryKey: ['my-quote-drafts'] });
            })
            .catch((e) => setError(getErrorMessage(e)));
        }
      }
      if (data.type === 'lvd-open-messages') {
        onClose();
        navigate('/portal/messages');
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open, submitFromIframe, onClose, navigate, customerPrefs, service, isAdmin, isDirectOrder]);

  if (!open) return null;

  return (
    <>
      <div
        className="overlay open"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
          <div className="modal-h">
            <div className="mh-t">
              <i className={`ti ${priceStep ? 'ti-currency-dollar' : service ? 'ti-file-pencil' : 'ti-plus'}`} />
              {priceStep
                ? 'Add line prices'
                : service
                  ? isAdmin
                    ? `${service.label} ${kindLabel}`
                    : `${service.label} ${kindLabel} request`
                  : `Start a new ${kindLabel}`}
            </div>
            <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
              <i className="ti ti-x" />
            </button>
          </div>
          <div className="modal-b">
            {error && (
              <div className="alert-error" style={{ marginBottom: 14 }}>
                {error}
              </div>
            )}

            <div className="steps" aria-hidden>
              <div className={`step${!service ? ' on' : ''}`} />
              <div className={`step${service && !priceStep ? ' on' : ''}`} />
              {isAdmin && <div className={`step${priceStep ? ' on' : ''}`} />}
            </div>

            {!service && (
              <>
                <div className="pick-intro">
                  Step 1 of {isAdmin ? 3 : 2}. Pick a service.{' '}
                  {isAdmin
                    ? 'This will be filed under the selected customer.'
                    : 'Your account details are already attached.'}
                </div>
                <div className="pick-grid">
                  {SERVICES.map((s) => (
                    <div
                      key={s.key}
                      className={`pick${s.mar ? ' mar' : ''}`}
                      onClick={() => {
                        setService(s);
                        setError(null);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setService(s);
                          setError(null);
                        }
                      }}
                    >
                      <div className="pic">
                        <i className={`ti ${s.icon}`} />
                      </div>
                      <div>
                        <div className="pt">{s.label}</div>
                        <div className="pd">{s.desc}</div>
                      </div>
                      <i className="ti ti-arrow-right parr" />
                    </div>
                  ))}
                </div>
              </>
            )}

            {service && (
              <>
                <div
                  style={{
                    display: priceStep ? 'none' : undefined,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 14,
                    }}
                  >
                    <button type="button" className="form-back" onClick={resetPicker}>
                      <i className="ti ti-arrow-left" /> Choose a different service
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--faint)' }}>
                      Submitting as <b style={{ color: 'var(--navy)' }}>{accountName}</b>
                    </span>
                  </div>
                  <iframe
                    ref={iframeRef}
                    className="form-frame"
                    title={`${service.label} ${kindLabel} form`}
                    src={`/portal-forms/${service.key}.html`}
                    onLoad={() => {
                      const win = iframeRef.current?.contentWindow;
                      if (!win) return;
                      win.postMessage(
                        {
                          type: 'lvd-set-context',
                          role: isAdmin ? 'admin' : 'customer',
                          kind: isDirectOrder ? 'order' : 'quote',
                        },
                        '*',
                      );
                    }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 10,
                      marginTop: 16,
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={onClose}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: 'right' }}>
                    {isAdmin
                      ? 'Use Continue to pricing inside the form. Next you will add prices and files.'
                      : 'Use the Submit button inside the form above to send your request.'}
                  </div>
                </div>

                {priceStep && (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 14,
                      }}
                    >
                      <button
                        type="button"
                        className="form-back"
                        onClick={() => {
                          setPriceStep(false);
                          setError(null);
                        }}
                      >
                        <i className="ti ti-arrow-left" /> Back to form
                      </button>
                      <span style={{ fontSize: 12, color: 'var(--faint)' }}>
                        Creating for <b style={{ color: 'var(--navy)' }}>{accountName}</b>
                      </span>
                    </div>
                    <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
                      {isDirectOrder
                        ? 'This order will be treated as already accepted by the customer and will start in progress.'
                        : 'This quote will be sent to the customer. They can accept, reject, or reply with a different price.'}
                    </p>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--faint)',
                        textTransform: 'uppercase',
                        letterSpacing: '.4px',
                        marginBottom: 6,
                      }}
                    >
                      Line items
                    </div>
                    {priceLines.map((line, idx) => (
                      <div
                        key={idx}
                        style={{
                          marginBottom: 10,
                          borderBottom: '0.5px solid var(--line)',
                          paddingBottom: 10,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <input
                            placeholder="Line name"
                            value={line.name}
                            onChange={(e) =>
                              setPriceLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, name: e.target.value } : l)),
                              )
                            }
                            style={{
                              flex: 1,
                              border: '0.5px solid var(--line)',
                              borderRadius: 8,
                              padding: '8px 10px',
                              fontSize: 12,
                              fontFamily: 'inherit',
                            }}
                          />
                          {priceLines.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setPriceLines((prev) => prev.filter((_, i) => i !== idx))
                              }
                            >
                              <i className="ti ti-trash" />
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            placeholder="Note (optional)"
                            value={line.note}
                            onChange={(e) =>
                              setPriceLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, note: e.target.value } : l)),
                              )
                            }
                            style={{
                              flex: 1,
                              border: '0.5px solid var(--line)',
                              borderRadius: 8,
                              padding: '8px 10px',
                              fontSize: 12,
                              fontFamily: 'inherit',
                            }}
                          />
                          <input
                            placeholder="Price"
                            inputMode="decimal"
                            value={line.price}
                            onChange={(e) =>
                              setPriceLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, price: e.target.value } : l)),
                              )
                            }
                            style={{
                              width: 110,
                              border: '0.5px solid var(--line)',
                              borderRadius: 8,
                              padding: '8px 10px',
                              fontSize: 12,
                              fontFamily: 'inherit',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ width: '100%', justifyContent: 'center', margin: '0 0 14px' }}
                      onClick={() => setPriceLines((prev) => [...prev, emptyPriceLine()])}
                    >
                      <i className="ti ti-plus" /> Add line
                    </button>

                    <div className="ff">
                      <label>Attachments</label>
                      {(formFiles.length > 0 || extraFiles.length > 0) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {formFiles.map((f, i) => (
                            <span key={`form-${f.name}-${i}`} className="odf">
                              <i className="ti ti-paperclip" /> {f.name}
                            </span>
                          ))}
                          {extraFiles.map((f, i) => (
                            <button
                              key={`extra-${f.name}-${i}`}
                              type="button"
                              className="odf"
                              onClick={() =>
                                setExtraFiles((prev) => prev.filter((_, idx) => idx !== i))
                              }
                            >
                              <i className="ti ti-paperclip" /> {f.name} <i className="ti ti-x" />
                            </button>
                          ))}
                        </div>
                      )}
                      <label className="odf up" style={{ cursor: 'pointer' }}>
                        <i className="ti ti-cloud-upload" /> Add files
                        <input
                          type="file"
                          multiple
                          hidden
                          onChange={(e) => {
                            const list = Array.from(e.target.files ?? []);
                            if (list.length) {
                              setExtraFiles((prev) => [...prev, ...list].slice(0, 20));
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderTop: '1px solid var(--line)',
                        paddingTop: 10,
                        margin: '12px 0',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
                      <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--navy)' }}>
                        {money(priceTotalCents)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      disabled={busy}
                      onClick={() => void finishAdminPriced()}
                    >
                      <i className={`ti ${isDirectOrder ? 'ti-check' : 'ti-send'}`} />
                      {busy
                        ? isDirectOrder
                          ? 'Creating…'
                          : 'Sending…'
                        : isDirectOrder
                          ? 'Create approved order'
                          : 'Send quote'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="toast show">
          <i className="ti ti-circle-check" /> {toast}
        </div>
      )}
    </>
  );
}
