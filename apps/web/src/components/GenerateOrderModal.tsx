import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { QuoteBuilderModal } from '@/components/QuoteBuilderModal';
import { listCustomers, type Customer } from '@/lib/customers';
import { canFeature } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';

type Mode = 'ORDER' | 'QUOTE_REQUEST';

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
  const { user } = useAuth();
  const canListCustomers = canFeature(user?.permissions, 'customers', user?.role);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);

  const customersQ = useQuery({
    queryKey: ['admin-customers-gen'],
    queryFn: () => listCustomers({ pageSize: 500 }),
    enabled: open && canListCustomers,
    retry: false,
  });
  const customers = customersQ.data?.customers ?? [];

  useEffect(() => {
    if (!open) return;
    setCustomerId(prefill?.customerId ?? null);
    setCustomerName(prefill?.customerName ?? '');
    setCustomerSearch(prefill?.customerName ?? '');
    setListOpen(false);
    setReady(Boolean(prefill?.customerId));
  }, [open, defaultMode, prefill?.customerId, prefill?.customerName]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) {
        setListOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers.slice(0, 40);
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.email ?? '').toLowerCase().includes(term) ||
          (c.phone ?? '').includes(term),
      )
      .slice(0, 40);
  }, [customers, customerSearch]);

  const selected = customers.find((c) => c.id === customerId);
  const pickedName = selected?.name || customerName;

  function pickCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerSearch(c.name);
    setListOpen(false);
  }

  function handleClose() {
    setReady(false);
    onClose();
  }

  if (!open) return null;

  if (ready && customerId) {
    return (
      <QuoteBuilderModal
        open
        adminFor={{
          customerId,
          customerName: pickedName,
          type: defaultMode,
        }}
        onClose={handleClose}
        onSubmitted={(id) => {
          navigate(defaultMode === 'QUOTE_REQUEST' ? `/admin/quotes/${id}` : `/admin/orders/${id}`);
        }}
      />
    );
  }

  const title = defaultMode === 'QUOTE_REQUEST' ? 'Generate quote' : 'Create order';

  return (
    <div
      className="overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, overflow: 'visible' }}>
        <div className="modal-h">
          <div className="mh-t">
            <i className={`ti ${defaultMode === 'QUOTE_REQUEST' ? 'ti-file-dollar' : 'ti-plus'}`} />
            {title}
          </div>
          <button type="button" className="modal-x" onClick={handleClose} aria-label="Close">
            <i className="ti ti-x" />
          </button>
        </div>
        <div className="modal-b">
          <p className="muted" style={{ margin: '0 0 14px' }}>
            {defaultMode === 'ORDER'
              ? 'First pick the customer. Then fill in the job details and add prices. The order starts as accepted and in progress.'
              : 'First pick the customer. Then fill in the job details and add prices. The quote is sent to the customer.'}
          </p>
          <div className="ff">
            <label>Customer (required)</label>
            <div ref={pickRef} style={{ position: 'relative' }}>
              <input
                placeholder="Search customers by name, email, phone…"
                value={customerSearch}
                autoComplete="off"
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerId(null);
                  setListOpen(true);
                }}
                onFocus={() => setListOpen(true)}
              />
              {listOpen && (
                <div className="search-drop open" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {customersQ.isLoading && <div className="sd-empty">Loading customers…</div>}
                  {!customersQ.isLoading && filteredCustomers.length === 0 && (
                    <div className="sd-empty">No matches.</div>
                  )}
                  {filteredCustomers.map((c) => (
                    <div key={c.id} className="sd-item" onClick={() => pickCustomer(c)}>
                      <div>
                        <div className="sd-t">{c.name}</div>
                        <div className="sd-s">{c.email || c.phone || 'No contact'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {customerId && selected ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>
                {selected.email || selected.phone || 'Customer selected'}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
                Select an existing customer. Create them under Customers first if needed.
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
            disabled={!customerId}
            onClick={() => setReady(true)}
          >
            <i className="ti ti-arrow-right" /> Continue to form
          </button>
        </div>
      </div>
    </div>
  );
}
