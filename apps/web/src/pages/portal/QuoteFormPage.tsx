import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createOrder, getQuoteDraft, saveQuoteDraft, uploadAttachments } from '@/lib/orders';
import { getErrorMessage } from '@/lib/api';
import { getMyCustomer } from '@/lib/customers';
import { useAuth } from '@/context/AuthContext';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { useDialog } from '@/components/ui/AppDialog';

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
  },
];

declare global {
  interface Window {
    LVD_COLLECT?: () => Collected;
    LVD_GET_FILES?: () => File[];
  }
}

export function QuoteFormPage() {
  const navigate = useNavigate();
  const dialog = useDialog();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dirtyRef = useRef(false);
  const initial = params.get('service');
  const found = SERVICES.find((s) => s.key === initial);
  const [service, setService] = useState<(typeof SERVICES)[number] | null>(found ?? null);
  const fallbackName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Your account';
  const [accountName, setAccountName] = useState(fallbackName);
  const [customerPrefs, setCustomerPrefs] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const match = SERVICES.find((s) => s.key === initial);
    setService(match ?? null);
  }, [initial]);

  useEffect(() => {
    void getMyCustomer()
      .then((res) => {
        setAccountName(res.customer?.name?.trim() || fallbackName);
        const prefs = res.customer?.preferences;
        setCustomerPrefs(prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>) : null);
      })
      .catch(() => {
        setAccountName(fallbackName);
        setCustomerPrefs(null);
      });
  }, [fallbackName]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const closePage = useCallback(async () => {
    if (dirtyRef.current) {
      const ok = await dialog.confirm({
        title: 'Discard this quote request?',
        message: 'Your unsaved information will be lost.',
        confirmLabel: 'Discard & Close',
        cancelLabel: 'Continue Editing',
        danger: true,
      });
      if (!ok) return;
    }
    navigate('/portal/quotes');
  }, [dialog, navigate]);

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
      });
      if (files.length > 0) await uploadAttachments(order.id, files);
      dirtyRef.current = false;
      await invalidateWorkCaches(qc);
      navigate(`/portal/quotes/${order.id}`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [service, qc, navigate]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data = ev.data as { type?: string; height?: number } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'lvd-form-height' && typeof data.height === 'number') {
        const next = Math.max(360, Math.ceil(data.height));
        if (iframeRef.current) iframeRef.current.style.height = `${next}px`;
      }
      if (data.type === 'lvd-form-ready') {
        const win = iframeRef.current?.contentWindow;
        if (win) {
          win.postMessage({ type: 'lvd-set-context', role: 'customer', kind: 'quote' }, '*');
        }
        if (win && customerPrefs) {
          win.postMessage({ type: 'lvd-apply-prefs', prefs: customerPrefs }, '*');
        }
        if (service) {
          void getQuoteDraft(service.key).then((res) => {
            if (res.draft && win) {
              win.postMessage({ type: 'lvd-restore-draft', draft: res.draft.payload }, '*');
              setToast('Restored your saved draft.');
            }
          });
        }
      }
      if (data.type === 'lvd-quote-submit') void submitFromIframe();
      if (data.type === 'lvd-quote-draft' || data.type === 'lvd-draft-saved') {
        const win = iframeRef.current?.contentWindow;
        const collected = win?.LVD_COLLECT?.();
        if (service && collected) {
          void saveQuoteDraft(service.key, collected)
            .then(() => {
              dirtyRef.current = false;
              setToast('Draft saved. You’ll see it on Quotes.');
              void qc.invalidateQueries({ queryKey: ['my-quote-drafts'] });
            })
            .catch((e) => setError(getErrorMessage(e)));
        }
      }
      if (data.type === 'lvd-open-messages') navigate('/portal/messages');
      if (data.type === 'lvd-form-dirty') dirtyRef.current = true;
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [submitFromIframe, navigate, customerPrefs, service, qc]);

  return (
    <div className="quote-page">
      <header className="quote-page-h">
        <div className="service-icon">
          <i className={`ti ${service?.icon ?? 'ti-file-pencil'}`} />
        </div>
        <div className="title-wrap">
          <h1>{service ? `${service.label} quote` : 'Request a quote'}</h1>
          <p>{service ? 'Upload your artwork and tell us what you need.' : 'Pick a service to begin.'}</p>
        </div>
        {service && (
          <button
            type="button"
            className="change-service"
            onClick={() => {
              void (async () => {
                if (dirtyRef.current) {
                  const ok = await dialog.confirm({
                    title: 'Discard this quote request?',
                    message: 'Your unsaved information will be lost.',
                    confirmLabel: 'Discard & Close',
                    cancelLabel: 'Continue Editing',
                    danger: true,
                  });
                  if (!ok) return;
                }
                dirtyRef.current = false;
                setService(null);
                navigate('/portal/quotes/new', { replace: true });
              })();
            }}
          >
            ← Change service
          </button>
        )}
        <span className="submitting">
          Submitting as <strong>{accountName}</strong>
        </span>
        <button type="button" className="close-form" onClick={() => void closePage()} aria-label="Close quote form">
          ×
        </button>
      </header>

      {error && <div className="alert-error">{error}</div>}

      <div className="quote-layout">
        <div>
          {!service && (
            <div className="pick-grid">
              {SERVICES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="pick"
                  onClick={() => {
                    setService(s);
                    navigate(`/portal/quotes/new?service=${s.key}`, { replace: true });
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
                </button>
              ))}
            </div>
          )}
          {service && (
            <iframe
              ref={iframeRef}
              className="form-frame quote-frame"
              title={`${service.label} quote form`}
              src={`/portal-forms/${service.key}.html`}
              onLoad={() => {
                const frame = iframeRef.current;
                if (frame) frame.style.height = '360px';
              }}
            />
          )}
        </div>
        <aside className="help-card">
          <span className="help-icon">
            <i className="ti ti-messages" />
          </span>
          <h2>Need help?</h2>
          <p>Not sure what to select? Our team can help with artwork, sizing and file requirements.</p>
          <Link className="help-button" to="/portal/messages">
            Chat with our team
          </Link>
        </aside>
      </div>
      {busy && <p className="muted">Submitting…</p>}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
