import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart } from '@/components/BarChart';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getErrorMessage } from '@/lib/api';
import { money, statusLabel } from '@/lib/format';
import {
  getReport,
  REPORT_OPTIONS,
  type BillingReport,
  type CustomersReport,
  type OrdersReport,
  type QuotesReport,
  type ReportKind,
  type RevisionsReport,
  type SalesReport,
  type TeamReport,
} from '@/lib/reports';

type RangePreset = 'week' | 'month' | 'thisMonth' | 'custom';

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function datesForPreset(preset: RangePreset, customFrom: string, customTo: string) {
  const today = new Date();
  if (preset === 'week') {
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (preset === 'month') {
    const from = new Date(today);
    from.setDate(today.getDate() - 29);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (preset === 'thisMonth') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDate(from), to: isoDate(today) };
  }
  return { from: customFrom, to: customTo };
}

function pretty(value: string | null | undefined) {
  if (!value) return 'Not set';
  const labels: Record<string, string> = {
    SUPER_ADMIN: 'Super admin',
    ADMIN: 'Admin',
    SUPPORT: 'Support',
    DESIGNER: 'Designer',
  };
  return labels[value] ?? value.replace(/_/g, ' ');
}

function hoursLabel(hours: number | null | undefined) {
  if (hours == null) return '—';
  if (hours < 24) return `${hours}h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days}d`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const body = rows
    .map((row) =>
      row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <div className="ml">{label}</div>
      <div className="mv">{value}</div>
    </div>
  );
}

function BreakdownTable({
  title,
  columns,
  rows,
  empty,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  empty: string;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ct">{title}</span>
      </div>
      <div className="table-wrap">
        <table className="qtable">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="muted">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={`${row[0]}-${i}`}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminReports() {
  const [kind, setKind] = useState<ReportKind | ''>('');
  const [preset, setPreset] = useState<RangePreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const selected = REPORT_OPTIONS.find((o) => o.value === kind);
  const needsRange = Boolean(selected?.needsRange);
  const dates = datesForPreset(preset, customFrom, customTo);
  const rangeReady = !needsRange || Boolean(dates.from && dates.to);

  const { data, isFetching, error } = useQuery({
    queryKey: ['admin-report', kind, needsRange ? dates.from : null, needsRange ? dates.to : null],
    queryFn: () => getReport(kind as ReportKind, needsRange ? dates : undefined),
    enabled: Boolean(kind) && rangeReady,
  });

  const chartPoints = useMemo(() => {
    if (!data) return [];
    if (data.kind === 'sales') {
      return data.report.series.map((p) => ({ date: p.date, revenue: p.revenueCents / 100 }));
    }
    if (data.kind === 'orders') {
      return data.report.series.map((p) => ({ date: p.date, orders: p.orders }));
    }
    return [];
  }, [data]);

  function onPickReport(value: string) {
    setKind((value || '') as ReportKind | '');
    setPreset('month');
    setCustomFrom('');
    setCustomTo('');
  }

  function exportCsv() {
    if (!data || !selected) return;
    const stamp = data.range ? `${data.range.startKey}_to_${data.range.endKey}` : 'current';
    const name = `lvd-${data.kind}-${stamp}.csv`;

    if (data.kind === 'sales') {
      downloadCsv(name, [
        ['date', 'revenue_cents'],
        ...data.report.series.map((p) => [p.date, String(p.revenueCents)]),
      ]);
      return;
    }
    if (data.kind === 'orders') {
      downloadCsv(name, [
        ['status', 'count'],
        ...data.report.byStatus.map((r) => [r.status, String(r.count)]),
      ]);
      return;
    }
    if (data.kind === 'quotes') {
      downloadCsv(name, [
        ['metric', 'value'],
        ['created', String(data.report.totals.created)],
        ['approved', String(data.report.totals.approved)],
        ['rejected', String(data.report.totals.rejected)],
        ['pending_review', String(data.report.totals.pendingReview)],
        ['expired', String(data.report.totals.expired)],
        ['conversion_percent', String(data.report.totals.conversionPercent)],
      ]);
      return;
    }
    if (data.kind === 'customers') {
      downloadCsv(name, [
        ['customer', 'email', 'orders', 'revenue_cents'],
        ...data.report.customers.map((c) => [
          c.name,
          c.email ?? '',
          String(c.ordersCount),
          String(c.revenueCents),
        ]),
      ]);
      return;
    }
    if (data.kind === 'team') {
      downloadCsv(name, [
        ['person', 'email', 'role', 'assigned', 'completed', 'pending', 'overdue', 'avg_hours'],
        ...data.report.members.map((m) => [
          m.name,
          m.email,
          m.role,
          String(m.assigned),
          String(m.completed),
          String(m.pending),
          String(m.overdue),
          m.avgCompletionHours == null ? '' : String(m.avgCompletionHours),
        ]),
      ]);
      return;
    }
    if (data.kind === 'billing') {
      const t = data.report.totals;
      downloadCsv(name, [
        ['metric', 'count', 'amount_cents'],
        ['generated', String(t.generated), String(t.generatedCents)],
        ['paid', String(t.paid), String(t.paidCents)],
        ['unpaid', String(t.unpaid), String(t.unpaidCents)],
        ['partial', String(t.partial), String(t.partialCents)],
        ['overdue', String(t.overdue), String(t.overdueCents)],
      ]);
      return;
    }
    downloadCsv(name, [
      ['customer', 'email', 'revisions'],
      ...data.report.topCustomers.map((c) => [c.name, c.email ?? '', String(c.count)]),
    ]);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Pick a report, then choose a time range."
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportCsv}
            disabled={!data}
          >
            <i className="ti ti-download" /> Download CSV
          </button>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-chart-bar" /> Choose a report
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <div className="ff" style={{ maxWidth: 420, marginBottom: needsRange ? 14 : 0 }}>
            <label htmlFor="report-type">Report</label>
            <select
              id="report-type"
              value={kind}
              onChange={(e) => onPickReport(e.target.value)}
            >
              <option value="">Select a report…</option>
              {REPORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {selected && (
            <p className="muted" style={{ margin: '0 0 4px', fontSize: 13 }}>
              {selected.description}
            </p>
          )}
          {needsRange && (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Time range
              </div>
              <div className="filters">
                <button
                  type="button"
                  className={preset === 'week' ? 'on' : ''}
                  onClick={() => setPreset('week')}
                >
                  7 days
                </button>
                <button
                  type="button"
                  className={preset === 'month' ? 'on' : ''}
                  onClick={() => setPreset('month')}
                >
                  30 days
                </button>
                <button
                  type="button"
                  className={preset === 'thisMonth' ? 'on' : ''}
                  onClick={() => setPreset('thisMonth')}
                >
                  This month
                </button>
                <button
                  type="button"
                  className={preset === 'custom' ? 'on' : ''}
                  onClick={() => setPreset('custom')}
                >
                  Custom
                </button>
              </div>
              {preset === 'custom' && (
                <div
                  className="report-dates"
                  style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}
                >
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="From date"
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    to
                  </span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="To date"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!kind && (
        <EmptyState
          icon="ti-chart-bar"
          title="Select a report"
          description="Choose one from the list above. A time range will appear next."
        />
      )}

      {kind && needsRange && preset === 'custom' && !rangeReady && (
        <EmptyState
          icon="ti-calendar"
          title="Pick dates"
          description="Choose a start and end date to load this report."
        />
      )}

      {error && <ErrorBanner>{getErrorMessage(error)}</ErrorBanner>}

      {kind && rangeReady && isFetching && !data && <p className="muted">Loading report…</p>}

      {data?.kind === 'sales' && <SalesView report={data.report} points={chartPoints} />}
      {data?.kind === 'orders' && <OrdersView report={data.report} points={chartPoints} />}
      {data?.kind === 'quotes' && <QuotesView report={data.report} />}
      {data?.kind === 'customers' && <CustomersView report={data.report} />}
      {data?.kind === 'team' && <TeamView report={data.report} />}
      {data?.kind === 'billing' && <BillingView report={data.report} />}
      {data?.kind === 'revisions' && <RevisionsView report={data.report} />}
    </div>
  );
}

function SalesView({
  report,
  points,
}: {
  report: SalesReport;
  points: Array<Record<string, unknown>>;
}) {
  return (
    <>
      <div className="metric-row" style={{ marginBottom: 16 }}>
        <Metric label="Total sales" value={report.totals.totalSales} />
        <Metric label="Revenue" value={money(report.totals.revenueCents)} />
        <Metric label="Paid amount" value={money(report.totals.paidCents)} />
        <Metric label="Pending amount" value={money(report.totals.pendingCents)} />
        <Metric label="Refunds" value={`${report.totals.refunds} · ${money(report.totals.refundedCents)}`} />
      </div>
      <div className="card">
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-chart-bar" /> Revenue by date
          </span>
        </div>
        <div style={{ padding: '8px 16px 16px' }}>
          {points.length === 0 ? (
            <div className="muted">No revenue in this range.</div>
          ) : (
            <BarChart
              data={points}
              valueKey="revenue"
              height={180}
              formatValue={(n) => `$${n.toFixed(0)}`}
            />
          )}
        </div>
      </div>
    </>
  );
}

function OrdersView({
  report,
  points,
}: {
  report: OrdersReport;
  points: Array<Record<string, unknown>>;
}) {
  return (
    <>
      <div className="metric-row" style={{ marginBottom: 16 }}>
        <Metric label="Total orders" value={report.totals.total} />
        <Metric label="Completed" value={report.totals.completed} />
        <Metric label="In progress" value={report.totals.inProgress} />
        <Metric label="Pending" value={report.totals.pending} />
        <Metric label="Cancelled" value={report.totals.cancelled} />
        <Metric label="Overdue" value={report.totals.overdue} />
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-chart-bar" /> Orders by day
          </span>
        </div>
        <div style={{ padding: '8px 16px 16px' }}>
          {points.length === 0 ? (
            <div className="muted">No orders in this range.</div>
          ) : (
            <BarChart
              data={points}
              valueKey="orders"
              height={180}
              formatValue={(n) => String(Math.round(n))}
            />
          )}
        </div>
      </div>
      <BreakdownTable
        title="By status"
        columns={['Status', 'Count']}
        rows={report.byStatus.map((r) => [statusLabel(r.status), r.count])}
        empty="No orders in this range."
      />
    </>
  );
}

function QuotesView({ report }: { report: QuotesReport }) {
  return (
    <>
      <div className="metric-row" style={{ marginBottom: 16 }}>
        <Metric label="Quotes created" value={report.totals.created} />
        <Metric label="Approved" value={report.totals.approved} />
        <Metric label="Rejected" value={report.totals.rejected} />
        <Metric label="Pending review" value={report.totals.pendingReview} />
        <Metric label="Expired" value={report.totals.expired} />
        <Metric label="Quote to order" value={`${report.totals.conversionPercent}%`} />
      </div>
      <BreakdownTable
        title="By status"
        columns={['Status', 'Count']}
        rows={report.byStatus.map((r) => [statusLabel(r.status), r.count])}
        empty="No quotes in this range."
      />
    </>
  );
}

function CustomersView({ report }: { report: CustomersReport }) {
  return (
    <>
      <div className="metric-row" style={{ marginBottom: 16 }}>
        <Metric label="New customers" value={report.totals.newCustomers} />
        <Metric label="Active customers" value={report.totals.activeCustomers} />
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <span className="ct">Top customers</span>
        </div>
        <div className="table-wrap">
          <table className="qtable">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Orders</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {report.topCustomers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No customer activity in this range.
                  </td>
                </tr>
              ) : (
                report.topCustomers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/customers?open=${c.id}`}>{c.name}</Link>
                      {c.email && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {c.email}
                        </div>
                      )}
                    </td>
                    <td>{c.ordersCount}</td>
                    <td>{money(c.revenueCents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-h">
          <span className="ct">Orders and revenue by customer</span>
        </div>
        <div className="table-wrap">
          <table className="qtable">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Orders</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {report.customers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No customer orders in this range.
                  </td>
                </tr>
              ) : (
                report.customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/customers?open=${c.id}`}>{c.name}</Link>
                      {c.email && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {c.email}
                        </div>
                      )}
                    </td>
                    <td>{c.ordersCount}</td>
                    <td>{money(c.revenueCents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function TeamView({ report }: { report: TeamReport }) {
  return (
    <>
      <div className="metric-row" style={{ marginBottom: 16 }}>
        <Metric label="Assigned" value={report.totals.assigned} />
        <Metric label="Completed" value={report.totals.completed} />
        <Metric label="Pending" value={report.totals.pending} />
        <Metric label="Overdue" value={report.totals.overdue} />
        <Metric label="Avg completion" value={hoursLabel(report.totals.avgCompletionHours)} />
      </div>
      <div className="card">
        <div className="card-h">
          <span className="ct">Workload by team member</span>
        </div>
        <div className="table-wrap">
          <table className="qtable">
            <thead>
              <tr>
                <th>Person</th>
                <th>Assigned</th>
                <th>Completed</th>
                <th>Pending</th>
                <th>Overdue</th>
                <th>Avg time</th>
              </tr>
            </thead>
            <tbody>
              {report.members.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No assigned work in this range.
                  </td>
                </tr>
              ) : (
                report.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {pretty(m.role)} · {m.email}
                      </div>
                    </td>
                    <td>{m.assigned}</td>
                    <td>{m.completed}</td>
                    <td>{m.pending}</td>
                    <td>{m.overdue}</td>
                    <td>{hoursLabel(m.avgCompletionHours)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function BillingView({ report }: { report: BillingReport }) {
  return (
    <div className="metric-row">
      <Metric
        label="Invoices generated"
        value={`${report.totals.generated} · ${money(report.totals.generatedCents)}`}
      />
      <Metric
        label="Paid"
        value={`${report.totals.paid} · ${money(report.totals.paidCents)}`}
      />
      <Metric
        label="Unpaid"
        value={`${report.totals.unpaid} · ${money(report.totals.unpaidCents)}`}
      />
      <Metric
        label="Partly paid"
        value={`${report.totals.partial} · ${money(report.totals.partialCents)}`}
      />
      <Metric
        label="Overdue payments"
        value={`${report.totals.overdue} · ${money(report.totals.overdueCents)}`}
      />
    </div>
  );
}

function RevisionsView({ report }: { report: RevisionsReport }) {
  return (
    <>
      <div className="metric-row" style={{ marginBottom: 16 }}>
        <Metric label="Total revisions" value={report.totals.total} />
        <Metric label="Revisions per order" value={report.totals.perOrder} />
        <Metric label="Pending" value={report.totals.pending} />
        <Metric label="Completed" value={report.totals.completed} />
      </div>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="card">
          <div className="card-h">
            <span className="ct">Revisions per order</span>
          </div>
          <div className="table-wrap">
            <table className="qtable">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Revisions</th>
                </tr>
              </thead>
              <tbody>
                {report.perOrder.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted">
                      No revisions in this range.
                    </td>
                  </tr>
                ) : (
                  report.perOrder.map((row) => (
                    <tr key={row.orderId}>
                      <td>
                        <Link to={`/admin/orders/${row.orderId}`}>{row.orderName}</Link>
                        {row.humanRef && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {row.humanRef}
                          </div>
                        )}
                      </td>
                      <td>{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <span className="ct">Customers requesting most revisions</span>
          </div>
          <div className="table-wrap">
            <table className="qtable">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Revisions</th>
                </tr>
              </thead>
              <tbody>
                {report.topCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted">
                      No revisions in this range.
                    </td>
                  </tr>
                ) : (
                  report.topCustomers.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/admin/customers?open=${c.id}`}>{c.name}</Link>
                        {c.email && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {c.email}
                          </div>
                        )}
                      </td>
                      <td>{c.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
