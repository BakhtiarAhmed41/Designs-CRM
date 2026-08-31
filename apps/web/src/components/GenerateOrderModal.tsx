import { useEffect, useMemo, useState } from 'react';
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
  const [ready, setReady] = useState(false);

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
    setReady(Boolean(prefill?.customerId));
  }, [open, defaultMode, prefill?.customerId, prefill?.customerName]);

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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
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
            First pick the customer. Then the same quote request form from the customer portal opens
            {defaultMode === 'ORDER'
              ? '. After you fill it, add line prices and files. The order starts as accepted and in progress.'
              : '.'}
          </p>
          <div className="ff">
            <label>Customer (required)</label>
            <input
              placeholder="Search customers by name, email, phone…"
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value);
                setCustomerId(null);
              }}
            />
            {!customerId && (
              <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
                Select an existing customer. Create them under Customers first if needed.
              </div>
            )}
            <div
              style={{
                maxHeight: 220,
                overflow: 'auto',
                marginTop: 6,
                border: '0.5px solid var(--line)',
                borderRadius: 8,
              }}
            >
              {customersQ.isLoading && (
                <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>Loading customers…</div>
              )}
              {filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickCustomer(c)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    border: 'none',
                    borderBottom: '0.5px solid var(--line-s)',
                    background: customerId === c.id ? 'rgba(20,63,101,.08)' : '#fff',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 12.5,
                  }}
                >
                  <b>{c.name}</b>
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}
                    · {c.email || c.phone || 'No contact'}
                  </span>
                </button>
              ))}
            </div>
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
