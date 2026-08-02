import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createOrder, uploadAttachments } from '@/lib/orders';
import { getErrorMessage } from '@/lib/api';
import { getMyCustomer } from '@/lib/customers';

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
    desc: 'Turn your logo into a stitch file — DST, PES and more.',
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
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted?: (orderId: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [service, setService] = useState<(typeof SERVICES)[number] | null>(null);
  const [accountName, setAccountName] = useState('Your account');
  const [customerPrefs, setCustomerPrefs] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const resetPicker = useCallback(() => {
    setService(null);
    setError(null);
    if (iframeRef.current) iframeRef.current.src = 'about:blank';
  }, []);

  useEffect(() => {
    if (!open) {
      resetPicker();
      return;
    }
    void getMyCustomer()
      .then((res) => {
        setAccountName(res.customer?.name ?? 'Your account');
        const prefs = res.customer?.preferences;
        setCustomerPrefs(
          prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>) : null,
        );
      })
      .catch(() => {
        setAccountName('Your account');
        setCustomerPrefs(null);
      });
  }, [open, resetPicker]);

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

      const { order } = await createOrder({
        type: 'QUOTE_REQUEST',
        serviceType: service.serviceType,
        name: collected.designName,
        subCategory: collected.designName,
        instructions: collected.instructions || null,
        size: collected.size,
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
      });

      if (files.length > 0) {
        await uploadAttachments(order.id, files);
      }

      await qc.invalidateQueries({ queryKey: ['my-orders'] });
      await qc.invalidateQueries({ queryKey: ['portal-orders-nav'] });
      setToast('Quote submitted — added to your Quotes as “Being priced.”');
      onSubmitted?.(order.id);
      window.setTimeout(() => onClose(), 500);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [service, qc, onClose, onSubmitted]);

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
        if (win && customerPrefs) {
          win.postMessage({ type: 'lvd-apply-prefs', prefs: customerPrefs }, '*');
        }
        if (data.restoredDraft) {
          setToast('Restored draft from this device.');
        }
      }
      if (data.type === 'lvd-quote-submit') {
        void submitFromIframe();
      }
      if (data.type === 'lvd-quote-draft' || data.type === 'lvd-draft-saved') {
        setToast('Draft saved on this device.');
      }
      if (data.type === 'lvd-open-messages') {
        onClose();
        navigate('/portal/messages');
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open, submitFromIframe, onClose, navigate, customerPrefs]);

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
              <i className={`ti ${service ? 'ti-file-pencil' : 'ti-plus'}`} />
              {service ? `${service.label} — quote request` : 'Start a new quote'}
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

            {!service && (
              <>
                <div className="pick-intro">
                  What kind of file do you need? Pick a service and we&apos;ll open the right form.
                  Your account details are already attached — no need to re-enter them.
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
                  title={`${service.label} quote form`}
                  src={`/portal-forms/${service.key}.html`}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 10,
                    marginTop: 16,
                  }}
                >
                  <button type="button" className="btn btn-ghost" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void submitFromIframe()}
                  >
                    <i className="ti ti-send" /> {busy ? 'Submitting…' : 'Submit request'}
                  </button>
                </div>
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
