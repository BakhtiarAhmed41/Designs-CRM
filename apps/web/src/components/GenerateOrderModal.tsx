import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminCreateOrder } from '@/lib/orders';
import { listCustomers, type Customer } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';

type Mode = 'ORDER' | 'QUOTE_REQUEST';

const SOURCES: Array<{ value: string; label: string }> = [
  { value: 'PORTAL', label: 'Portal' },
  { value: 'ETSY', label: 'Etsy' },
  { value: 'TEXT', label: 'Text' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'DIRECT', label: 'Direct' },
];

const SERVICES: Array<{ value: string; label: string }> = [
  { value: 'EMBROIDERY', label: 'Embroidery digitizing' },
  { value: 'SVG', label: 'SVG & cut files' },
  { value: 'VECTOR', label: 'Vector & print' },
  { value: 'CNC_LASER', label: 'CNC / laser' },
];

export function GenerateOrderModal({
  open,
  onClose,
  defaultMode = 'ORDER',
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  defaultMode?: Mode;
  prefill?: {
    customerId?: string | null;
    customerName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('PORTAL');
  const [serviceType, setServiceType] = useState('EMBROIDERY');
  const [size, setSize] = useState('');
  const [name, setName] = useState('');
  const [designCount, setDesignCount] = useState('1');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resultLink, setResultLink] = useState<string | null>(null);
  const [resultLabel, setResultLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

  const customersQ = useQuery({
    queryKey: ['admin-customers-gen'],
    queryFn: () => listCustomers(),
    enabled: open,
  });

  const customers = customersQ.data?.customers ?? [];
  const datalistId = 'gen-order-customers';

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode);
    setCustomerName(prefill?.customerName ?? '');
    setCustomerId(prefill?.customerId ?? null);
    setEmail(prefill?.email ?? '');
    setPhone(prefill?.phone ?? '');
    setSource('PORTAL');
    setServiceType('EMBROIDERY');
    setSize('');
    setName('');
    setDesignCount('1');
    setPrice('');
    setNotes('');
    setError(null);
    setResultLink(null);
    setResultLabel('');
    setCopied(false);
    setCreatedOrderId(null);
  }, [open, defaultMode, prefill?.customerId, prefill?.customerName, prefill?.email, prefill?.phone]);

  const matchCustomer = (nameValue: string): Customer | undefined => {
    const exact = customers.find(
      (c) => c.name.toLowerCase() === nameValue.trim().toLowerCase(),
    );
    return exact;
  };

  const onCustomerNameChange = (value: string) => {
    setCustomerName(value);
    const match = matchCustomer(value);
    if (match) {
      setCustomerId(match.id);
      if (match.email) setEmail(match.email);
      if (match.phone) setPhone(match.phone);
    } else {
      setCustomerId(null);
    }
  };

  const absoluteLink = useMemo(() => {
    if (!resultLink) return null;
    if (resultLink.startsWith('http')) return resultLink;
    return `${window.location.origin}${resultLink}`;
  }, [resultLink]);

  const create = useMutation({
    mutationFn: () => {
      const priceCents = price.trim()
        ? Math.round(parseFloat(price) * 100)
        : null;
      const count = designCount.trim() ? parseInt(designCount, 10) : null;
      return adminCreateOrder({
        type: mode,
        customerId,
        customerName: customerName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        source,
        channel: source,
        serviceType,
        size: size.trim() || null,
        name: name.trim() || null,
        designCount: count && count > 0 ? count : null,
        priceCents:
          priceCents != null && Number.isFinite(priceCents) ? priceCents : null,
        instructions: notes.trim() || null,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-quotes'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard-stats'] });
      setCreatedOrderId(res.order.id);
      if (res.payLinkUrl) {
        setResultLink(res.payLinkUrl);
        setResultLabel('Payment link ready');
      } else if (res.quoteUrl) {
        setResultLink(res.quoteUrl);
        setResultLabel('Quote created');
      } else {
        const path =
          mode === 'QUOTE_REQUEST'
            ? `/admin/quotes/${res.order.id}`
            : `/admin/orders/${res.order.id}`;
        setResultLink(path);
        setResultLabel(mode === 'QUOTE_REQUEST' ? 'Quote created' : 'Order created');
      }
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  if (!open) return null;

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>
            {mode === 'QUOTE_REQUEST' ? 'Generate quote' : 'Generate order'}
          </span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {resultLink && absoluteLink ? (
            <div>
              <div className="note" style={{ marginTop: 0, marginBottom: 14 }}>
                <i className="ti ti-circle-check" /> {resultLabel}. Share this link
                with the customer.
              </div>
              <div className="ff">
                <label>Link</label>
                <input readOnly value={absoluteLink} onFocus={(e) => e.target.select()} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={async () => {
                    await navigator.clipboard.writeText(absoluteLink);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  <i className="ti ti-copy" /> {copied ? 'Copied!' : 'Copy link'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => {
                    onClose();
                    if (createdOrderId) {
                      navigate(
                        mode === 'QUOTE_REQUEST'
                          ? `/admin/quotes/${createdOrderId}`
                          : `/admin/orders/${createdOrderId}`,
                      );
                    }
                  }}
                >
                  Open
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${mode === 'ORDER' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setMode('ORDER')}
                >
                  Order
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${mode === 'QUOTE_REQUEST' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setMode('QUOTE_REQUEST')}
                >
                  Quote
                </button>
              </div>

              {error && (
                <div className="alert-error" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              )}

              <div className="ff">
                <label>Customer name</label>
                <input
                  list={datalistId}
                  placeholder="Start typing to match existing…"
                  value={customerName}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                />
                <datalist id={datalistId}>
                  {customers.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.email ?? c.phone ?? ''}
                    </option>
                  ))}
                </datalist>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="ff">
                  <label>Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="ff">
                  <label>Phone</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="ff">
                  <label>Source</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)}>
                    {SOURCES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ff">
                  <label>Service</label>
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)}
                  >
                    {SERVICES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="ff">
                  <label>Size</label>
                  <input
                    placeholder='e.g. 3.5"'
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                  />
                </div>
                <div className="ff">
                  <label># designs</label>
                  <input
                    type="number"
                    min={1}
                    value={designCount}
                    onChange={(e) => setDesignCount(e.target.value)}
                  />
                </div>
              </div>

              <div className="ff">
                <label>Design / order name</label>
                <input
                  placeholder="e.g. Eagle logo left chest"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="ff">
                <label>
                  Price {mode === 'ORDER' ? '(creates pay link)' : '(optional)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="$"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>

              <div className="ff">
                <label>Notes</label>
                <textarea
                  placeholder="Instructions or context…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                disabled={create.isPending || !customerName.trim()}
                onClick={() => create.mutate()}
              >
                <i className="ti ti-plus" />{' '}
                {create.isPending
                  ? 'Creating…'
                  : mode === 'QUOTE_REQUEST'
                    ? 'Generate quote'
                    : 'Generate order'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
