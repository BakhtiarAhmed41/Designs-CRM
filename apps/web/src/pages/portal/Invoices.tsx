import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMyInvoices,
  openInvoicePrint,
  payMyInvoice,
  type Invoice,
  type PayMethod,
} from '@/lib/billing';
import { getMyCustomer } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort } from '@/lib/format';

type InvFilter = 'all' | 'pending' | 'paid';

function invoiceChip(status: Invoice['status'], kind: Invoice['kind'], periodMonth: string | null) {
  if (kind === 'MONTHLY' && status === 'AWAITING' && !periodMonth) {
    return { cls: 'chip c-prog', label: 'Building' };
  }
  if (status === 'PAID') return { cls: 'chip c-paid', label: 'Paid' };
  return { cls: 'chip c-unpaid', label: 'Pending' };
}

export function PortalInvoices() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<InvFilter>('all');
  const [error, setError] = useState<string | null>(null);

  const { data: meCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['my-invoices'],
    queryFn: listMyInvoices,
    refetchInterval: 30000,
  });

  const isNet = meCustomer?.customer?.accountType === 'NET_MONTHLY';
  const invoices = data?.invoices ?? [];
  const storeCreditCents = data?.storeCreditCents ?? 0;

  const filtered = useMemo(() => {
    if (filter === 'pending') return invoices.filter((i) => i.status === 'AWAITING');
    if (filter === 'paid') return invoices.filter((i) => i.status === 'PAID');
    return invoices;
  }, [invoices, filter]);

  const runningMonth = useMemo(() => {
    const now = new Date();
    return invoices
      .filter(
        (i) =>
          i.kind === 'MONTHLY' &&
          i.periodMonth ===
            now.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', '-'),
      )
      .reduce((s, i) => s + i.amountCents, 0);
  }, [invoices]);

  const lastPending = invoices.find((i) => i.status === 'AWAITING' && i.kind === 'MONTHLY');
  const paidLifetime = invoices
    .filter((i) => i.status === 'PAID')
    .reduce((s, i) => s + i.amountCents, 0);

  const payMut = useMutation({
    mutationFn: ({ id, method }: { id: string; method: PayMethod }) => payMyInvoice(id, method),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['my-invoices'] });
      qc.invalidateQueries({ queryKey: ['portal-invoices-nav'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Invoices</h1>
          <div className="sub">
            {isNet
              ? "Your monthly statements and their status. This month's running total is shown up top."
              : 'View your invoices — paid and pending — and download any as a PDF.'}
          </div>
        </div>
      </div>

      {error && (
        <div className="alert-error" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {isNet && (
        <div className="month-banner" style={{ marginTop: 20 }}>
          <div className="mb-l">
            <div className="ml">This month so far — {monthName}</div>
            <div className="mv">{money(runningMonth || lastPending?.amountCents || 0)}</div>
            <div className="md">Statement generates on the 1st of next month</div>
          </div>
          <div className="mb-r">
            <div className="mstat">
              Your terms:{' '}
              <b>{meCustomer?.customer?.netTerms === 'NET_30' ? 'Net-30' : 'Net-15'}</b>
            </div>
            <div className="mstat" style={{ marginTop: 6 }}>
              Store credit: <b>{money(storeCreditCents)}</b>
            </div>
          </div>
        </div>
      )}

      <div className="stats" style={{ marginTop: 20 }}>
        {isNet ? (
          <>
            <div className="stat">
              <div className="sl">Running this month</div>
              <div className="sv maroon">{money(runningMonth)}</div>
              <div className="sd" />
            </div>
            <div className="stat">
              <div className="sl">Last statement</div>
              <div className="sv">{money(lastPending?.amountCents ?? 0)}</div>
              <div className="sd">{lastPending?.periodMonth ?? '—'} · pending</div>
            </div>
            <div className="stat">
              <div className="sl">Paid to date</div>
              <div className="sv">{money(paidLifetime)}</div>
              <div className="sd">Lifetime</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat">
              <div className="sl">Pending</div>
              <div className="sv maroon">
                {money(
                  invoices
                    .filter((i) => i.status === 'AWAITING')
                    .reduce((s, i) => s + i.amountCents, 0),
                )}
              </div>
              <div className="sd">
                {invoices.filter((i) => i.status === 'AWAITING').length} invoice(s)
              </div>
            </div>
            <div className="stat">
              <div className="sl">Paid this year</div>
              <div className="sv">{money(paidLifetime)}</div>
              <div className="sd">{invoices.filter((i) => i.status === 'PAID').length} paid</div>
            </div>
            <div className="stat">
              <div className="sl">Store credit</div>
              <div className="sv">{money(storeCreditCents)}</div>
              <div className="sd">Available balance</div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">Invoice history</span>
          <div className="filters">
            {(
              [
                ['all', 'All'],
                ['pending', 'Pending'],
                ['paid', 'Paid'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={filter === k ? 'on' : undefined}
                onClick={() => setFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && <div className="empty">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="empty">
            <i className="ti ti-receipt" />
            <p>You have no invoices yet.</p>
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <table className="itable">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>{isNet ? 'Statement' : 'Order'}</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const chip = invoiceChip(inv.status, inv.kind, inv.periodMonth);
                const canPay = inv.status === 'AWAITING' && inv.amountCents > 0;
                const useCredit = storeCreditCents >= inv.amountCents;
                const invId =
                  inv.periodMonth?.toUpperCase().replace(' ', '-') ??
                  inv.id.slice(0, 8).toUpperCase();

                return (
                  <tr key={inv.id}>
                    <td className="inv-id">{invId}</td>
                    <td>{inv.coversText ?? (inv.kind === 'MONTHLY' ? 'Monthly statement' : 'Invoice')}</td>
                    <td style={{ color: 'var(--muted)' }}>{inv.kind === 'MONTHLY' ? 'Statement' : 'Order'}</td>
                    <td className="amt">{money(inv.amountCents, inv.currency)}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {inv.status === 'AWAITING' && chip.label === 'Building'
                        ? '—'
                        : dateShort(inv.issuedAt) || '—'}
                    </td>
                    <td>
                      <span className={chip.cls}>{chip.label}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canPay && chip.label !== 'Building' ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={payMut.isPending}
                          onClick={() =>
                            payMut.mutate({
                              id: inv.id,
                              method: useCredit ? 'STORE_CREDIT' : 'CARD',
                            })
                          }
                        >
                          Pay
                        </button>
                      ) : chip.label === 'Paid' ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            void openInvoicePrint(inv.id).catch((e) =>
                              setError(getErrorMessage(e)),
                            );
                          }}
                        >
                          <i className="ti ti-download" /> PDF
                        </button>
                      ) : (
                        <span style={{ color: 'var(--faint)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
