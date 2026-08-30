import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adjustStoreCredit,
  cancelInvoice,
  createInvoice,
  createPayLink,
  getBillingSummary,
  getStoreCredit,
  listInvoices,
  openInvoicePrint,
  payInvoice,
  refundInvoice,
  remindInvoice,
  runMonthEnd,
  type Invoice,
  type MonthEndResult,
  type PayMethod,
  type RefundTo,
} from '@/lib/billing';
import { listCustomers } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { money, dateShort } from '@/lib/format';
import { serviceTi, serviceThumbClass } from '@/lib/serviceIcon';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';

export function AdminBilling() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [payLink, setPayLink] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<Invoice | null>(null);
  const [creditFor, setCreditFor] = useState<Invoice | null>(null);
  const [monthEndResult, setMonthEndResult] = useState<MonthEndResult | null>(null);
  const [invoiceQ, setInvoiceQ] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCustomerId, setCreateCustomerId] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [createCover, setCreateCover] = useState('');
  const [createCustomerSearch, setCreateCustomerSearch] = useState('');

  const summaryQ = useQuery({
    queryKey: ['billing-summary'],
    queryFn: getBillingSummary,
    ...freshOnOpen,
    refetchInterval: 30_000,
  });

  const invoicesQ = useQuery({
    queryKey: ['admin-invoices-all', invoiceQ, invoiceStatus],
    queryFn: () =>
      listInvoices({
        q: invoiceQ || undefined,
        status: invoiceStatus || undefined,
      }),
    ...freshOnOpen,
    refetchInterval: 30_000,
  });

  const customersQ = useQuery({
    queryKey: ['admin-customers-billing'],
    queryFn: () => listCustomers({ pageSize: 500 }),
    enabled: createOpen,
  });

  const invoices = invoicesQ.data?.invoices ?? [];
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(invoices.length / pageSize));
  const pagedInvoices = invoices.slice((page - 1) * pageSize, page * pageSize);
  const unpaidLinks = invoices.filter((i) => i.status === 'AWAITING' && i.kind === 'PER_ORDER');
  const monthlyStatements = invoices.filter((i) => i.kind === 'MONTHLY' && i.status === 'AWAITING');
  const s = summaryQ.data;

  function invalidateAll() {
    void invalidateWorkCaches(qc);
  }

  const createMut = useMutation({
    mutationFn: () => {
      const dollars = parseFloat(createAmount);
      if (!createCustomerId) throw new Error('Select a customer');
      if (!Number.isFinite(dollars) || dollars <= 0) throw new Error('Enter a valid amount');
      return createInvoice({
        customerId: createCustomerId,
        amountCents: Math.round(dollars * 100),
        coversText: createCover.trim() || null,
      });
    },
    onSuccess: () => {
      setError(null);
      setCreateOpen(false);
      setCreateCustomerId('');
      setCreateAmount('');
      setCreateCover('');
      setCreateCustomerSearch('');
      invalidateAll();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const payMut = useMutation({
    mutationFn: ({ id, method }: { id: string; method: PayMethod }) => payInvoice(id, method),
    onSuccess: () => {
      setError(null);
      invalidateAll();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const linkMut = useMutation({
    mutationFn: (id: string) => createPayLink(id),
    onSuccess: (res) => {
      setError(null);
      setPayLink(`${window.location.origin}${res.url}`);
      invalidateAll();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const remindMut = useMutation({
    mutationFn: (id: string) => remindInvoice(id),
    onSuccess: () => {
      setError(null);
      invalidateAll();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelInvoice(id),
    onSuccess: () => {
      setError(null);
      invalidateAll();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const monthEndMut = useMutation({
    mutationFn: () => runMonthEnd(),
    onSuccess: (res) => {
      setError(null);
      setMonthEndResult(res);
      invalidateAll();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const avgOrder =
    s && s.paidThisMonthCents > 0
      ? Math.round(s.paidThisMonthCents / Math.max(1, unpaidLinks.length + monthlyStatements.length + 1))
      : 0;

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Billing</h1>
          <div className="sub">
            Revenue, outstanding balances, invoices, refunds, and month-end statements.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <i className="ti ti-plus" /> Create invoice
        </button>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 14 }}>{error}</div>}

      <ListToolbar
        search={invoiceQ}
        onSearch={setInvoiceQ}
        searchPlaceholder="Search invoices by customer, cover, order…"
        status={invoiceStatus}
        onStatus={setInvoiceStatus}
        statusOptions={[
          { value: '', label: 'All statuses' },
          { value: 'AWAITING', label: 'Unpaid' },
          { value: 'PAID', label: 'Paid' },
          { value: 'CANCELLED', label: 'Cancelled' },
        ]}
      />

      <div className="metric-row">
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Received this month</div>
          <div className="mv alert">{money(s?.paidThisMonthCents ?? 0)}</div>
          <div className="md">Paid invoices</div>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Outstanding</div>
          <div className="mv">{money(s?.outstandingCents ?? 0)}</div>
          <div className="md">{unpaidLinks.length} unpaid</div>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Net-monthly unbilled</div>
          <div className="mv">{money(s?.netMonthlyUnbilledCents ?? 0)}</div>
          <div className="md">
            {monthlyStatements.length} statement{monthlyStatements.length === 1 ? '' : 's'} waiting
          </div>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Avg order value</div>
          <div className="mv">{money(avgOrder)}</div>
          <div className="md">This month</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-link" /> Unpaid payment links
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Links auto-expire after 7 days</span>
        </div>
        {unpaidLinks.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No unpaid payment links.</div>
        )}
        {unpaidLinks.map((inv) => (
          <div key={inv.id} className="orow" style={{ cursor: 'default' }}>
            <div className="othumb">
              <i className="ti ti-needle-thread" />
            </div>
            <div className="oinfo">
              <div className="on">{inv.customerName ?? 'Customer'}</div>
              <div className="om">
                <span>
                  <i className="ti ti-hash" style={{ fontSize: 11 }} />
                  {inv.coversText ?? inv.id.slice(0, 6)}
                </span>
                <span>Issued {dateShort(inv.issuedAt)}</span>
              </div>
            </div>
            <span className="chip c-new">Awaiting payment</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={linkMut.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  linkMut.mutate(inv.id);
                }}
              >
                <i className="ti ti-credit-card" /> Pay-link
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={remindMut.isPending}
                title="Sends a payment reminder with a card checkout link"
                onClick={(e) => {
                  e.stopPropagation();
                  remindMut.mutate(inv.id);
                }}
              >
                <i className="ti ti-bell" /> Remind
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--maroon)' }}
                disabled={cancelMut.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('Cancel this invoice?')) {
                    cancelMut.mutate(inv.id);
                  }
                }}
              >
                <i className="ti ti-x" />
              </button>
            </div>
            <div className="oprice">{money(inv.amountCents, inv.currency)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-file-invoice" /> Monthly statements for net-monthly accounts
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={monthEndMut.isPending}
            onClick={() => monthEndMut.mutate()}
          >
            <i className="ti ti-file-invoice" /> Generate all
          </button>
        </div>
        <div className="note" style={{ margin: '14px 16px' }}>
          <i className="ti ti-info-circle" /> On the 1st, all unbilled logos for each trade account roll into one
          statement. Review here. Nothing sends until you approve.
        </div>
        {monthlyStatements.length === 0 && (
          <div style={{ padding: '0 16px 16px', color: 'var(--muted)' }}>No statements ready.</div>
        )}
        {monthlyStatements.map((inv) => (
          <div key={inv.id} className="orow" style={{ cursor: 'default' }}>
            <div className={`othumb ${serviceThumbClass('embroidery')}`}>
              {(inv.customerName ?? '??').slice(0, 2).toUpperCase()}
            </div>
            <div className="oinfo">
              <div className="on">{inv.customerName ?? 'Customer'}</div>
              <div className="om">
                <span>{inv.coversText ?? inv.periodMonth ?? 'Monthly statement'}</span>
              </div>
            </div>
            <span className="chip c-prog">Ready to bill</span>
            <div className="oprice">{money(inv.amountCents, inv.currency)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-receipt" /> All invoices
          </span>
        </div>
        {invoicesQ.isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>}
        {pagedInvoices.map((inv) => (
          <div key={inv.id} className="orow" style={{ cursor: 'default' }}>
            <div className="othumb">
              <i className={`ti ${inv.kind === 'MONTHLY' ? 'ti-file-invoice' : serviceTi('embroidery')}`} />
            </div>
            <div className="oinfo">
              <div className="on">{inv.customerName ?? 'Customer'}</div>
              <div className="om">
                <span>
                  {inv.coversText ??
                    (inv.kind === 'MONTHLY'
                      ? 'Monthly'
                      : inv.kind === 'ADD_ON'
                        ? 'Add-on'
                        : 'Per order')}
                </span>
                <span>{dateShort(inv.issuedAt)}</span>
              </div>
            </div>
            <span className={`chip ${inv.status === 'PAID' ? 'c-done' : inv.status === 'CANCELLED' ? 'c-wait' : 'c-new'}`}>
              {inv.status === 'PAID' ? 'Paid' : inv.status === 'CANCELLED' ? 'Cancelled' : 'Awaiting'}
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {inv.status === 'AWAITING' && (
                <>
                  <button
                    type="button"
                    className="btn btn-green btn-sm"
                    onClick={() => payMut.mutate({ id: inv.id, method: 'CARD' })}
                  >
                    Mark paid
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => linkMut.mutate(inv.id)}
                  >
                    <i className="ti ti-credit-card" /> Card link
                  </button>
                </>
              )}
              {inv.status === 'PAID' && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefundFor(inv)}>
                    Refund
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void openInvoicePrint(inv.id, true).catch((e) =>
                        setError(getErrorMessage(e)),
                      );
                    }}
                  >
                    <i className="ti ti-download" /> PDF
                  </button>
                </>
              )}
              {inv.status !== 'PAID' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    void openInvoicePrint(inv.id, true).catch((e) =>
                      setError(getErrorMessage(e)),
                    );
                  }}
                >
                  <i className="ti ti-printer" /> Print
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreditFor(inv)}>
                Credit +/−
              </button>
            </div>
            <div className="oprice">{money(inv.amountCents, inv.currency)}</div>
          </div>
        ))}
      </div>
      <PaginationBar page={page} totalPages={totalPages} total={invoices.length} onPage={setPage} />

      {payLink && <PayLinkModal url={payLink} onClose={() => setPayLink(null)} />}
      {monthEndResult && (
        <MonthEndModal result={monthEndResult} onClose={() => setMonthEndResult(null)} />
      )}
      {refundFor && (
        <RefundModal
          invoice={refundFor}
          onClose={() => setRefundFor(null)}
          onDone={() => {
            setRefundFor(null);
            invalidateAll();
          }}
        />
      )}
      {creditFor && (
        <StoreCreditModal
          customerId={creditFor.customerId}
          customerName={creditFor.customerName}
          onClose={() => setCreditFor(null)}
          onDone={() => {
            setCreditFor(null);
            invalidateAll();
          }}
        />
      )}
      {createOpen && (
        <div className="overlay open" onClick={() => setCreateOpen(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <span>Create invoice</span>
              <button type="button" className="modal-x" onClick={() => setCreateOpen(false)}>
                &times;
              </button>
            </div>
            <div className="modal-b">
              <div className="ff">
                <label>Customer</label>
                <input
                  placeholder="Search customers…"
                  value={createCustomerSearch}
                  onChange={(e) => setCreateCustomerSearch(e.target.value)}
                />
                <select
                  value={createCustomerId}
                  onChange={(e) => setCreateCustomerId(e.target.value)}
                  style={{ marginTop: 8 }}
                >
                  <option value="">Select customer…</option>
                  {(customersQ.data?.customers ?? [])
                    .filter((c) => {
                      const term = createCustomerSearch.trim().toLowerCase();
                      if (!term) return true;
                      return (
                        c.name.toLowerCase().includes(term) ||
                        (c.email ?? '').toLowerCase().includes(term)
                      );
                    })
                    .slice(0, 80)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.email ? ` · ${c.email}` : ''}
                      </option>
                    ))}
                </select>
              </div>
              <div className="ff">
                <label>Amount (USD)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={createAmount}
                  onChange={(e) => setCreateAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="ff">
                <label>Covers / notes</label>
                <input
                  value={createCover}
                  onChange={(e) => setCreateCover(e.target.value)}
                  placeholder="What this invoice is for"
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? 'Creating…' : 'Create invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PayLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Customer card pay link</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          <div className="ff">
            <label>Send this link. The customer pays by card on Stripe.</label>
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              navigator.clipboard?.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MonthEndModal({ result, onClose }: { result: MonthEndResult; onClose: () => void }) {
  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Month-end {result.periodMonth}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {result.created.length === 0 && <div className="note">No new monthly invoices created.</div>}
          {result.created.map((c) => (
            <div key={c.invoiceId} className="orow" style={{ cursor: 'default' }}>
              <div className="oinfo">
                <div className="on">{c.customerName}</div>
                <div className="om">
                  <span>{c.orderCount} orders</span>
                </div>
              </div>
              <div className="oprice">{money(c.amountCents)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RefundModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: Invoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState((invoice.amountCents / 100).toFixed(2));
  const [to, setTo] = useState<RefundTo>('CARD');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      refundInvoice(invoice.id, {
        amountCents: Math.round(Number(amount) * 100),
        to,
        reason: reason || undefined,
      }),
    onSuccess: onDone,
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Refund invoice</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>Amount</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="ff">
            <label>Refund to</label>
            <select value={to} onChange={(e) => setTo(e.target.value as RefundTo)}>
              <option value="CARD">Card</option>
              <option value="STORE_CREDIT">Store credit</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={mut.isPending || !(Number(amount) > 0)}
            onClick={() => mut.mutate()}
          >
            Issue refund
          </button>
        </div>
      </div>
    </div>
  );
}

function StoreCreditModal({
  customerId,
  customerName,
  onClose,
  onDone,
}: {
  customerId: string;
  customerName: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('0.00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const balanceQ = useQuery({
    queryKey: ['store-credit', customerId],
    queryFn: () => getStoreCredit(customerId),
  });

  const mut = useMutation({
    mutationFn: (deltaCents: number) =>
      adjustStoreCredit(customerId, { deltaCents, reason: reason || undefined }),
    onSuccess: onDone,
    onError: (e) => setError(getErrorMessage(e)),
  });

  const cents = Math.round(Number(amount) * 100);

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Store credit for {customerName ?? 'Customer'}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="note" style={{ marginBottom: 12 }}>
            Current balance: <b>{money(balanceQ.data?.balanceCents ?? 0)}</b>
          </div>
          <div className="ff">
            <label>Amount</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-green"
              disabled={mut.isPending || !(cents > 0)}
              onClick={() => mut.mutate(cents)}
            >
              Add credit
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={mut.isPending || !(cents > 0)}
              onClick={() => mut.mutate(-cents)}
            >
              Deduct
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
