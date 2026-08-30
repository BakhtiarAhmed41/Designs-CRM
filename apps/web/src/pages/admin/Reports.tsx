import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart } from '@/components/BarChart';
import { getDashboardChart, getDashboardStats } from '@/lib/dashboard';
import { money, statusLabel } from '@/lib/format';
import { freshOnOpen } from '@/lib/queryRefresh';
import { PageHeader } from '@/components/ui/PageHeader';

type RangeKey = 'week' | 'month' | 'custom';

export function AdminReports() {
  const [range, setRange] = useState<RangeKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { data: statsData } = useQuery({
    queryKey: ['admin-dashboard-stats'],
    queryFn: getDashboardStats,
    ...freshOnOpen,
  });
  const chartDays = range === 'week' ? 7 : 30;
  const { data: chartData } = useQuery({
    queryKey: ['admin-reports-chart', chartDays, range, customFrom, customTo],
    queryFn: () =>
      getDashboardChart(
        chartDays,
        range === 'custom' && customFrom && customTo
          ? { from: customFrom, to: customTo }
          : undefined,
      ),
    enabled: range !== 'custom' || Boolean(customFrom && customTo),
  });

  const stats = statsData?.stats;
  const series = chartData?.series ?? [];
  const chartPoints = useMemo(
    () =>
      series.map((p) => ({
        ...p,
        revenue: (p.deliveredValueCents ?? 0) / 100,
      })),
    [series],
  );

  function downloadCsv() {
    const rows = [
      'date,orders,revenue_cents',
      ...series.map((p) => `${p.date},${p.orders},${p.deliveredValueCents}`),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lvd-report.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Orders, money, and workload for the studio."
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={downloadCsv} disabled={series.length === 0}>
            <i className="ti ti-download" /> Download CSV
          </button>
        }
      />

      <div className="metric-row" style={{ marginBottom: 16 }}>
        <div className="metric">
          <div className="ml">Active orders</div>
          <div className="mv">{stats?.ordersActive ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="ml">In progress</div>
          <div className="mv">{stats?.inProgress ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="ml">Quotes to price</div>
          <div className="mv">{stats?.quotesToPrice ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="ml">Open revisions</div>
          <div className="mv">{stats?.revisionsOpen ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="ml">Delivered this month</div>
          <div className="mv">{stats?.deliveredThisMonth ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="ml">Revenue this month</div>
          <div className="mv">{money(stats?.revenueThisMonthCents ?? 0)}</div>
        </div>
        <div className="metric">
          <div className="ml">Outstanding</div>
          <div className="mv">{money(stats?.outstandingCents ?? 0)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <span className="ct">
            <i className="ti ti-chart-bar" /> Orders and revenue
          </span>
          <div className="filters">
            <button type="button" className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>
              7 days
            </button>
            <button type="button" className={range === 'month' ? 'on' : ''} onClick={() => setRange('month')}>
              30 days
            </button>
            <button type="button" className={range === 'custom' ? 'on' : ''} onClick={() => setRange('custom')}>
              Custom
            </button>
          </div>
        </div>
        {range === 'custom' && (
          <div style={{ display: 'flex', gap: 8, padding: '0 16px 8px' }}>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
        <div style={{ padding: '8px 16px 16px' }}>
          {chartPoints.length === 0 ? (
            <div className="muted">No data for this range.</div>
          ) : (
            <BarChart
              data={chartPoints}
              valueKey="orders"
              valueKey2="revenue"
              height={180}
              formatValue={(n) => String(Math.round(n))}
              formatValue2={(n) => `$${n.toFixed(0)}`}
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ct">Orders by status</span>
        </div>
        <div className="table-wrap">
          <table className="qtable">
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byStatus ?? []).map((row) => (
                <tr key={row.status}>
                  <td>{statusLabel(row.status)}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
              {(stats?.byStatus ?? []).length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
