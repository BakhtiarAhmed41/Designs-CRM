import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmMyInvoice,
  invoiceRemainingCents,
  isInvoiceOpen,
  isInvoiceOverdue,
  listMyInvoices,
  openInvoicePrint,
  payMyInvoice,
  startMyInvoiceCheckout,
  type Invoice,
} from '@/lib/billing';
import { getMyCustomer } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { money, dateShort } from '@/lib/format';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PaginationBar } from '@/components/lists/ListToolbar';

type InvFilter = 'all' | 'pending' | 'paid';

function invoiceChip(inv: Invoice) {
  if (inv.kind === 'MONTHLY' && inv.status === 'AWAITING' && !inv.periodMonth) {
    return { cls: 'chip c-prog', label: 'Building' };
  }
  if (inv.status === 'PAID') return { cls: 'chip c-paid', label: 'Paid' };
  if (inv.status === 'PARTIAL') return { cls: 'chip c-prog', label: 'Partially paid' };
  if (isInvoiceOverdue(inv)) return { cls: 'chip c-unpaid', label: 'Overdue' };
  return { cls: 'chip c-unpaid', label: 'Pending' };
}

export function PortalInvoices() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const paidReturn = params.get('paid') === '1';
  const [filter, setFilter] = useState<InvFilter>('all');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const confirmedReturn = useRef(false);

  const { data: meCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['my-invoices'],
    queryFn: listMyInvoices,
    ...freshOnOpen,
    refetchInterval: 30000,
  });

  const isNet = meCustomer?.customer?.accountType === 'NET_MONTHLY';
  const invoices = data?.invoices ?? [];
  const storeCreditCents = data?.storeCreditCents ?? 0;
  const unbilledMonthCents = data?.unbilledMonthCents ?? 0;

  const filtered = useMemo(() => {
    if (filter === 'pending') return invoices.filter((i) => isInvoiceOpen(i.status));
    if (filter === 'paid') return invoices.filter((i) => i.status === 'PAID');
    return invoices;
  }, [invoices, filter]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const runningMonth = useMemo(() => {
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const billedThisMonth = invoices
      .filter((i) => i.kind === 'MONTHLY' && i.periodMonth === period)
      .reduce((s, i) => s + i.amountCents, 0);
    return billedThisMonth + unbilledMonthCents;
  }, [invoices, unbilledMonthCents]);

  const lastPending = invoices.find((i) => isInvoiceOpen(i.status) && i.kind === 'MONTHLY');
  const paidLifetime = invoices
    .filter((i) => i.status === 'PAID')
    .reduce((s, i) => s + i.amountCents, 0);

  useEffect(() => {
    if (!paidReturn || confirmedReturn.current) return;
    const awaiting = (data?.invoices ?? []).filter((i) => isInvoiceOpen(i.status));
    if (!data) return;
    confirmedReturn.current = true;
    void Promise.all(awaiting.map((i) => confirmMyInvoice(i.id).catch(() => null))).then(
      () => void invalidateWorkCaches(qc),
    );
  }, [paidReturn, data, qc]);

  const payMut = useMutation({
    mutationFn: async (inv: Invoice) => {
      const remaining = invoiceRemainingCents(inv);
      if (storeCreditCents >= remaining && remaining > 0) {
        const ok = window.confirm(
          `Pay ${money(remaining, inv.currency)} from your store credit?`,
        );
        if (!ok) return;
        await payMyInvoice(inv.id, 'STORE_CREDIT');
        return;
      }
      if (storeCreditCents > 0 && storeCreditCents < remaining) {
        const ok = window.confirm(
          `Apply ${money(storeCreditCents, inv.currency)} of store credit toward the ${money(remaining, inv.currency)} balance? The rest stays outstanding.`,
        );
        if (ok) {
          await payMyInvoice(inv.id, 'STORE_CREDIT');
          return;
        }
      }
      await startMyInvoiceCheckout(inv.id);
    },
    onSuccess: () => {
      setError(null);
      void invalidateWorkCaches(qc);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={
          isNet
            ? "Monthly statements and this month’s running total."
            : 'Paid and pending invoices. Download a PDF or pay from here.'
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {isNet && (
        <div className="month-banner">
          <div className="mb-l">
            <div className="ml">This month so far ({monthName})</div>
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

      <div className="stats">
        {isNet ? (
          <>
            <div className="stat">
              <div className="sl">Running this month</div>
              <div className="sv maroon">{money(runningMonth)}</div>
              <div className="sd" />
            </div>
            <div className="stat">
              <div className="sl">Last statement</div>
              <div className="sv">{money(lastPending ? invoiceRemainingCents(lastPending) : 0)}</div>
              <div className="sd">{lastPending?.periodMonth ?? 'None'} · {lastPending?.status === 'PARTIAL' ? 'partial' : 'pending'}</div>
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
                    .filter((i) => isInvoiceOpen(i.status))
                    .reduce((s, i) => s + invoiceRemainingCents(i), 0),
                )}
              </div>
              <div className="sd">
                {invoices.filter((i) => isInvoiceOpen(i.status)).length} invoice(s)
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
                onClick={() => {
                  setFilter(k);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && <div className="empty">Loading invoices…</div>}
        {!isLoading && filtered.length === 0 && (
          <EmptyState
            icon="ti-receipt"
            title={filter === 'all' ? 'No invoices yet' : 'Nothing in this filter'}
            description="Invoices appear after an order is billed."
          />
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="table-wrap">
          <table className="itable">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>{isNet ? 'Statement' : 'Order'}</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paged.map((inv) => {
                const chip = invoiceChip(inv);
                const remaining = invoiceRemainingCents(inv);
                const canPay = isInvoiceOpen(inv.status) && remaining > 0;
                const useCredit = storeCreditCents >= remaining;
                const invId =
                  inv.periodMonth?.toUpperCase().replace(' ', '-') ??
                  inv.id.slice(0, 8).toUpperCase();

                return (
                  <tr key={inv.id}>
                    <td className="inv-id">{invId}</td>
                    <td>{inv.coversText ?? (inv.kind === 'MONTHLY' ? 'Monthly statement' : 'Invoice')}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {inv.kind === 'MONTHLY'
                        ? 'Statement'
                        : inv.kind === 'ADD_ON'
                          ? 'Add-on'
                          : 'Order'}
                    </td>
                    <td className="amt">{money(remaining > 0 && remaining !== inv.amountCents ? remaining : inv.amountCents, inv.currency)}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {chip.label === 'Building'
                        ? 'Pending'
                        : inv.dueAt
                          ? dateShort(inv.dueAt)
                          : dateShort(inv.issuedAt) || 'None'}
                    </td>
                    <td>
                      <span className={chip.cls}>{chip.label}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {canPay && chip.label !== 'Building' && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={payMut.isPending}
                            onClick={() => payMut.mutate(inv)}
                          >
                            <i className={`ti ${useCredit ? 'ti-wallet' : 'ti-credit-card'}`} />{' '}
                            {useCredit ? 'Use credit' : 'Pay with card'}
                          </button>
                        )}
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={filtered.length}
        onPage={setPage}
      />
    </div>
  );
}
