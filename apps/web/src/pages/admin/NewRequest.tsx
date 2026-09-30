import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/api';
import { getCustomer, listCustomers, type Customer } from '@/lib/customers';
import { isUsualQuoteService, quoteFormatsFromPrefs } from '@/lib/customerPrefs';
import { orderSlug } from '@/lib/format';
import { adminCreateOrder, adminUploadAttachments } from '@/lib/orders';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { filesFromQuoteForm } from '@/lib/quoteFiles';
import { postThemeToWindow } from '@/lib/theme';
import { useTopbarLead } from '@/components/Shell';
import { useDialog } from '@/components/ui/AppDialog';
import { useTheme } from '@/context/ThemeContext';

type Mode = 'QUOTE_REQUEST' | 'ORDER';

type ServiceKey = 'embroidery' | 'vector' | 'laser';

type Collected = {
  mode: string;
  designName: string;
  instructions: string;
  size: string | null;
  unit?: string | null;
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
  title: string;
  desc: string;
  icon: string;
}> = [
  {
    key: 'embroidery',
    serviceType: 'EMBROIDERY',
    label: 'Embroidery Digitizing',
    title: 'Embroidery Digitizing',
    desc: 'Turn a logo into a stitch file. DST, PES and more.',
    icon: 'ti-needle-thread',
  },
  {
    key: 'vector',
    serviceType: 'VECTOR',
    label: 'Vector & Print Artwork',
    title: 'Vector & Print',
    desc: 'Logo redraws and print-ready color separations.',
    icon: 'ti-vector-bezier',
  },
  {
    key: 'laser',
    serviceType: 'CNC_LASER',
    label: 'Cutting & Engraving Files',
    title: 'Cutting & Engraving',
    desc: 'Cutting, engraving, print files and plasma files.',
    icon: 'ti-router',
  },
];

const COPY: Record<Mode, { title: string; blurb: string; nextStep: string; listPath: string }> = {
  QUOTE_REQUEST: {
    title: 'Generate a quote',
    blurb: 'Fill in the job for the customer, then price it and send the quote.',
    nextStep: 'Next you will price it and send the quote.',
    listPath: '/admin/quotes',
  },
  ORDER: {
    title: 'Generate an order',
    blurb: 'Fill in the job for the customer, then enter the prices they will pay.',
    nextStep: 'Next you will enter the order prices.',
    listPath: '/admin/orders',
  },
};

function customerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function accountTypeLabel(type: Customer['accountType']) {
  return type === 'NET_MONTHLY' ? 'Net monthly' : 'Pay per order';
}

function customerContact(c: Pick<Customer, 'email' | 'phone'>) {
  return [c.email, c.phone].filter(Boolean).join(' · ') || 'No contact on file';
}

function highlightMatch(text: string, term: string) {
  if (!term.trim()) return text;
  const lower = text.toLowerCase();
  const needle = term.trim().toLowerCase();
  const at = lower.indexOf(needle);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function fallbackCollected(): Collected {
  return {
    mode: 'd',
    designName: 'New design request',
    instructions: '',
    size: null,
    unit: null,
    turnaround: null,
    formats: [],
    designs: [],
    fields: [],
    advanced: {},
    formVersion: 1,
  };
}

export function AdminNewRequest({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const navigate = useNavigate();
  const dialog = useDialog();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { colors: themeColors } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  const pickInputRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);

  const [customerId, setCustomerId] = useState<string | null>(params.get('customerId'));
  const [customerSearch, setCustomerSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [customerPrefs, setCustomerPrefs] = useState<Record<string, unknown> | null>(null);
  const [customerLabel, setCustomerLabel] = useState('');
  const [hasPortalLogin, setHasPortalLogin] = useState(true);
  const [service, setService] = useState<(typeof SERVICES)[number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customersQ = useQuery({
    queryKey: ['admin-customers-new-request'],
    queryFn: () => listCustomers({ pageSize: 500 }),
    retry: false,
  });
  const customers = customersQ.data?.customers ?? [];

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setListOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!customerId) {
      setCustomerPrefs(null);
      setCustomerLabel('');
      setHasPortalLogin(true);
      return;
    }
    let live = true;
    void getCustomer(customerId)
      .then((res) => {
        if (!live) return;
        const prefs = res.customer?.preferences;
        setCustomerPrefs(
          prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>) : null,
        );
        const name = res.customer?.name?.trim() || 'Customer';
        setCustomerLabel(name);
        setHasPortalLogin(Boolean(res.customer?.userId));
      })
      .catch(() => {
        if (!live) return;
        setCustomerPrefs(null);
        setHasPortalLogin(true);
      });
    return () => {
      live = false;
    };
  }, [customerId]);

  useEffect(() => {
    postThemeToWindow(iframeRef.current?.contentWindow, themeColors);
  }, [themeColors, service]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    const list = !term
      ? customers
      : customers.filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            (c.email ?? '').toLowerCase().includes(term) ||
            (c.phone ?? '').includes(term),
        );
    return list.slice(0, 40);
  }, [customers, customerSearch]);

  useEffect(() => {
    setActiveIdx(0);
  }, [customerSearch, listOpen]);

  useEffect(() => {
    if (!listOpen) return;
    const el = pickRef.current?.querySelector<HTMLElement>(`[data-cust-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, listOpen]);

  const confirmLoseForm = useCallback(
    async (title: string, confirmLabel: string) => {
      if (!dirtyRef.current) return true;
      const ok = await dialog.confirm({
        title,
        message: 'The details you filled in on this form will be lost.',
        confirmLabel,
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (ok) dirtyRef.current = false;
      return ok;
    },
    [dialog],
  );

  const closePage = useCallback(async () => {
    const ok = await confirmLoseForm(
      mode === 'ORDER' ? 'Discard this order?' : 'Discard this quote?',
      'Discard & Close',
    );
    if (!ok) return;
    navigate(copy.listPath);
  }, [confirmLoseForm, mode, navigate, copy.listPath]);

  function pickCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerLabel(c.name);
    setCustomerSearch('');
    setHasPortalLogin(Boolean(c.userId));
    setListOpen(false);
    setError(null);
  }

  function openCustomerPicker() {
    setCustomerSearch('');
    setListOpen(true);
    window.setTimeout(() => pickInputRef.current?.focus(), 0);
  }

  function clearCustomer() {
    setCustomerId(null);
    setCustomerLabel('');
    setCustomerSearch('');
    setCustomerPrefs(null);
    setHasPortalLogin(true);
    setListOpen(true);
    setError(null);
    window.setTimeout(() => pickInputRef.current?.focus(), 0);
  }

  function onPickerKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setListOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!listOpen) {
        setListOpen(true);
        return;
      }
      setActiveIdx((i) => Math.min(i + 1, Math.max(filteredCustomers.length - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && listOpen) {
      const next = filteredCustomers[activeIdx];
      if (!next) return;
      e.preventDefault();
      pickCustomer(next);
    }
  }

  const changeSelection = useCallback(async () => {
    const ok = await confirmLoseForm('Change the service or customer?', 'Change service or customer');
    if (!ok) return;
    setService(null);
  }, [confirmLoseForm]);

  const submitFromIframe = useCallback(
    async (postedFiles?: unknown) => {
      if (!service || !customerId) return;
      setError(null);
      setBusy(true);
      try {
        const win = iframeRef.current?.contentWindow;
        const collected: Collected = win?.LVD_COLLECT?.() ?? fallbackCollected();
        const files = filesFromQuoteForm(
          (Array.isArray(postedFiles) && postedFiles.length
            ? postedFiles
            : win?.LVD_GET_FILES?.()) ?? [],
        );
        const { order } = await adminCreateOrder({
          type: mode,
          customerId,
          customerName: customerLabel || undefined,
          source: 'PORTAL',
          channel: 'ADMIN',
          serviceType: service.serviceType,
          name: collected.designName,
          subCategory: collected.designName,
          instructions: collected.instructions || null,
          size: collected.size,
          turnaroundKey: collected.turnaround,
          designCount: collected.designs?.length || undefined,
          preferences: {
            service: service.key,
            serviceType: service.serviceType,
            mode: collected.mode,
            turnaround: collected.turnaround,
            unit: collected.unit ?? null,
            formats: quoteFormatsFromPrefs(collected.formats, customerPrefs, service.key),
            designs: collected.designs,
            fields: collected.fields,
            advanced: collected.advanced,
            formVersion: collected.formVersion,
          },
        });
        if (files.length > 0) await adminUploadAttachments(order.id, files);
        dirtyRef.current = false;
        await invalidateWorkCaches(qc);
        const slug = orderSlug(order.humanRef, order.id);
        navigate(mode === 'ORDER' ? `/admin/orders/${slug}` : `/admin/quotes/${slug}`, {
          replace: true,
        });
      } catch (e) {
        setError(getErrorMessage(e));
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'lvd-quote-submit-result', ok: false },
          '*',
        );
      } finally {
        setBusy(false);
      }
    },
    [service, customerId, customerLabel, customerPrefs, mode, qc, navigate],
  );

  const sendContext = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    postThemeToWindow(win, themeColors);
    win.postMessage(
      { type: 'lvd-set-context', role: 'admin', kind: mode === 'ORDER' ? 'order' : 'quote' },
      '*',
    );
    if (customerPrefs) win.postMessage({ type: 'lvd-apply-prefs', prefs: customerPrefs }, '*');
  }, [themeColors, mode, customerPrefs]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data = ev.data as { type?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'lvd-form-ready') sendContext();
      if (data.type === 'lvd-quote-cancel') void closePage();
      if (data.type === 'lvd-form-dirty') dirtyRef.current = true;
      if (data.type === 'lvd-quote-submit') {
        void submitFromIframe((data as { files?: unknown }).files);
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [sendContext, closePage, submitFromIframe]);

  useEffect(() => {
    if (!service || !customerPrefs) return;
    const win = iframeRef.current?.contentWindow;
    if (win) win.postMessage({ type: 'lvd-apply-prefs', prefs: customerPrefs }, '*');
  }, [service, customerPrefs]);

  const topbarLead = useMemo(
    () => (
      <div className="quote-topbar-lead">
        <i className={`ti ${service?.icon ?? (mode === 'ORDER' ? 'ti-plus' : 'ti-file-dollar')}`} />
        <div className="quote-topbar-copy">
          <strong>{service ? `${service.title} · ${copy.title}` : copy.title}</strong>
          <span>{service ? `For ${customerLabel || 'the selected customer'}` : copy.blurb}</span>
        </div>
        {service && (
          <button type="button" className="change-service" onClick={() => void changeSelection()}>
            Change service or customer
            <i className="ti ti-refresh" />
          </button>
        )}
      </div>
    ),
    [service, mode, copy.title, copy.blurb, customerLabel, changeSelection],
  );
  useTopbarLead(topbarLead);

  const selected = customers.find((c) => c.id === customerId);

  return (
    <div className={`quote-page${service ? ' quote-page-live' : ''}`}>
      <header className="quote-page-h quote-page-h-mobile">
        <div className="service-icon">
          <i className={`ti ${service?.icon ?? 'ti-file-pencil'}`} />
        </div>
        <div className="title-wrap">
          <h1>{service ? service.title : copy.title}</h1>
        </div>
        {service && (
          <button type="button" className="change-service" onClick={() => void changeSelection()}>
            Change service or customer
            <i className="ti ti-refresh" />
          </button>
        )}
        <button
          type="button"
          className="close-form"
          onClick={() => void closePage()}
          aria-label="Close form"
        >
          ×
        </button>
      </header>

      {error && <div className="alert-error">{error}</div>}

      <div className={`quote-layout${service ? ' quote-layout-form' : ''}`}>
        <div>
          {!service && (
            <>
              <div className={`card${listOpen ? ' card-over' : ''}`} style={{ marginBottom: 14 }}>
                <div className="card-h">
                  <span className="ct">
                    <i className="ti ti-user" /> Step 1 · Pick the customer
                  </span>
                </div>
                <div className="card-b">
                  <div className="ff">
                    <label htmlFor="customer-picker">Customer</label>
                    <div ref={pickRef} className="cust-pick">
                      {customerId && !listOpen ? (
                        <div className="cust-pick-card">
                          <span className={`cust-av${selected?.accountType === 'NET_MONTHLY' ? ' m' : ''}`}>
                            {customerInitials(selected?.name || customerLabel || 'C')}
                          </span>
                          <div className="cust-pick-copy">
                            <div className="cust-pick-name">{selected?.name || customerLabel || 'Customer'}</div>
                            <div className="cust-pick-meta">
                              {selected ? customerContact(selected) : 'Customer selected'}
                            </div>
                            <div className="cust-pick-tags">
                              {selected && (
                                <span className={selected.accountType === 'NET_MONTHLY' ? 'chip c-quote' : 'chip c-new'}>
                                  {accountTypeLabel(selected.accountType)}
                                </span>
                              )}
                              {!hasPortalLogin && <span className="chip c-wait">No portal login</span>}
                            </div>
                          </div>
                          <div className="cust-pick-actions">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={openCustomerPicker}>
                              Change
                            </button>
                            <button
                              type="button"
                              className="cust-pick-x"
                              aria-label="Clear customer"
                              onClick={clearCustomer}
                            >
                              <i className="ti ti-x" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className={`cust-pick-field${listOpen ? ' is-open' : ''}`}>
                          <i className="ti ti-search" aria-hidden />
                          <input
                            id="customer-picker"
                            ref={pickInputRef}
                            placeholder="Search name, email, or phone…"
                            autoComplete="off"
                            role="combobox"
                            aria-expanded={listOpen}
                            aria-controls="customer-picker-list"
                            aria-autocomplete="list"
                            value={customerSearch}
                            onChange={(e) => {
                              setCustomerSearch(e.target.value);
                              setListOpen(true);
                            }}
                            onFocus={() => setListOpen(true)}
                            onKeyDown={onPickerKeyDown}
                          />
                          {customerSearch && (
                            <button
                              type="button"
                              className="cust-pick-x"
                              aria-label="Clear search"
                              onClick={() => {
                                setCustomerSearch('');
                                pickInputRef.current?.focus();
                              }}
                            >
                              <i className="ti ti-x" />
                            </button>
                          )}
                          <i className={`ti ti-chevron-${listOpen ? 'up' : 'down'}`} aria-hidden />
                        </div>
                      )}
                      {listOpen && (
                        <div id="customer-picker-list" className="cust-pick-drop" role="listbox">
                          {customersQ.isLoading && <div className="cust-pick-empty">Loading customers…</div>}
                          {customersQ.isError && (
                            <div className="cust-pick-empty">Could not load customers. Try again.</div>
                          )}
                          {!customersQ.isLoading && !customersQ.isError && filteredCustomers.length === 0 && (
                            <div className="cust-pick-empty">
                              No matches{customerSearch.trim() ? ` for “${customerSearch.trim()}”` : ''}.
                              <Link to="/admin/customers">Create a customer</Link>
                            </div>
                          )}
                          {filteredCustomers.map((c, idx) => (
                            <button
                              key={c.id}
                              type="button"
                              role="option"
                              aria-selected={c.id === customerId || idx === activeIdx}
                              data-cust-idx={idx}
                              className={`cust-pick-item${idx === activeIdx ? ' is-on' : ''}${c.id === customerId ? ' is-picked' : ''}`}
                              onMouseEnter={() => setActiveIdx(idx)}
                              onClick={() => pickCustomer(c)}
                            >
                              <span className={`cust-av${c.accountType === 'NET_MONTHLY' ? ' m' : ''}`}>
                                {customerInitials(c.name)}
                              </span>
                              <span className="cust-pick-copy">
                                <span className="cust-pick-name">{highlightMatch(c.name, customerSearch)}</span>
                                <span className="cust-pick-meta">
                                  {highlightMatch(customerContact(c), customerSearch)}
                                </span>
                              </span>
                              <span className="cust-pick-side">
                                <span className={c.accountType === 'NET_MONTHLY' ? 'chip c-quote' : 'chip c-new'}>
                                  {accountTypeLabel(c.accountType)}
                                </span>
                                {!c.userId && <span className="cust-pick-warn">No login</span>}
                                {c.id === customerId && <i className="ti ti-check" />}
                              </span>
                            </button>
                          ))}
                          {filteredCustomers.length > 0 && customers.length > filteredCustomers.length && (
                            <div className="cust-pick-foot">
                              Showing {filteredCustomers.length} of {customers.length}. Type to narrow.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {!customerId && (
                      <div className="cust-pick-hint">
                        Select an existing customer.{' '}
                        <Link to="/admin/customers">Add one first</Link> if they are not in the list.
                      </div>
                    )}
                  </div>
                  {customerId && !hasPortalLogin && (
                    <div className="note amber" style={{ marginTop: 10 }}>
                      <i className="ti ti-alert-triangle" /> This customer has no portal login yet,
                      so they will not see this in the portal. Invite them from Customers first if
                      they need to {mode === 'ORDER' ? 'pay online' : 'accept the quote'}.
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-h">
                  <span className="ct">
                    <i className="ti ti-list-details" /> Step 2 · Pick the service
                  </span>
                </div>
                <div className="card-b">
                  {!customerId && (
                    <p className="muted" style={{ margin: '0 0 12px', fontSize: 12.5 }}>
                      Pick a customer first.
                    </p>
                  )}
                  <div className="pick-grid">
                    {SERVICES.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        className={`pick${isUsualQuoteService(customerPrefs, s.key) ? ' usual' : ''}`}
                        disabled={!customerId}
                        style={!customerId ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                        onClick={() => setService(s)}
                      >
                        <div className="pic">
                          <i className={`ti ${s.icon}`} />
                        </div>
                        <div className="pick-copy">
                          <div className="pt">
                            {s.label}
                            {isUsualQuoteService(customerPrefs, s.key) && (
                              <span className="pick-usual">Usual</span>
                            )}
                          </div>
                          <div className="pd">{s.desc}</div>
                        </div>
                        <i className="ti ti-arrow-right parr" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
          {service && (
            <iframe
              ref={iframeRef}
              className="form-frame quote-frame"
              title={`${service.label} form`}
              src={`/portal-forms/${service.key}.html`}
              onLoad={() => {
                sendContext();
                iframeRef.current?.contentWindow?.postMessage(
                  { type: 'lvd-request-height' },
                  '*',
                );
              }}
            />
          )}
        </div>
        {!service && (
          <aside className="help-card">
            <span className="help-icon">
              <i className="ti ti-info-circle" />
            </span>
            <h2>How this works</h2>
            <p>
              You fill in the same form the customer would use, so nothing is missing.{' '}
              {copy.nextStep}
            </p>
          </aside>
        )}
      </div>
      {busy && (
        <div className="quote-submit-mask">
          {mode === 'ORDER' ? 'Creating the order…' : 'Creating the quote…'}
        </div>
      )}
    </div>
  );
}

export function AdminNewQuote() {
  return <AdminNewRequest mode="QUOTE_REQUEST" />;
}

export function AdminNewOrder() {
  return <AdminNewRequest mode="ORDER" />;
}
