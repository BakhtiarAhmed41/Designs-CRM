import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyFiles, type MyFile } from '@/lib/designs';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { myDeliveryFileUrl } from '@/lib/orders';
import { downloadSignedFile } from '@/lib/api';
import { dateShort, deliveryMethodLabel } from '@/lib/format';
import { serviceCategoryLabel } from '@/lib/serviceIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PaginationBar } from '@/components/lists/ListToolbar';

type Group = {
  key: string;
  orderId: string;
  orderName: string | null;
  humanRef: string | null;
  serviceType: string | null;
  deliveredAt: string;
  deliveredVia: string | null;
  deliveryEmail: string | null;
  files: MyFile[];
};

function maskEmail(email?: string | null) {
  if (!email || !email.includes('@')) return 'your email';
  const [user, domain] = email.split('@');
  const keep = user.slice(0, 2);
  return `${keep}***@${domain}`;
}

function dayKey(iso: string) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(iso: string) {
  return dayKey(iso).slice(0, 7);
}

function monthHeading(key: string) {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function fileSizeLabel(bytes?: number | null) {
  if (bytes == null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PortalFiles() {
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [method, setMethod] = useState('all');
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['my-files'],
    queryFn: listMyFiles,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Group>();
    for (const f of data?.files ?? []) {
      const key = `${f.orderId}-${dayKey(f.deliveredAt)}`;
      const g = byKey.get(key);
      if (g) g.files.push(f);
      else {
        byKey.set(key, {
          key,
          orderId: f.orderId,
          orderName: f.orderName,
          humanRef: f.humanRef,
          serviceType: f.serviceType ?? null,
          deliveredAt: f.deliveredAt,
          deliveredVia: f.deliveredVia ?? null,
          deliveryEmail: f.deliveryEmail ?? null,
          files: [f],
        });
      }
    }
    return Array.from(byKey.values()).sort(
      (a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime(),
    );
  }, [data]);

  const months = useMemo(() => {
    const keys = new Set(groups.map((g) => monthKey(g.deliveredAt)));
    return Array.from(keys);
  }, [groups]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return groups.filter((g) => {
      const day = dayKey(g.deliveredAt);
      if (month !== 'all' && monthKey(g.deliveredAt) !== month) return false;
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (method === 'portal' && g.deliveredVia !== 'PORTAL') return false;
      if (method === 'email' && g.deliveredVia !== 'EMAIL') return false;
      if (!term) return true;
      return (
        (g.orderName ?? '').toLowerCase().includes(term) ||
        (g.humanRef ?? '').toLowerCase().includes(term) ||
        serviceCategoryLabel(g.serviceType).toLowerCase().includes(term) ||
        g.files.some((f) => f.originalName.toLowerCase().includes(term))
      );
    });
  }, [groups, q, month, method, dateFrom, dateTo]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const paged = visible.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        title="My Files"
        subtitle="Find and download files delivered with your completed orders."
      />

      <div className="list-toolbar">
        <div className="searchbar" style={{ flex: 1, maxWidth: 420 }}>
          <i className="ti ti-search si" aria-hidden />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search by order number or name"
            aria-label="Search files"
          />
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          aria-label="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          aria-label="To date"
        />
        <select
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setPage(1);
          }}
          aria-label="Month"
        >
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthHeading(m)}
            </option>
          ))}
        </select>
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setPage(1);
          }}
          aria-label="Delivery method"
        >
          <option value="all">All delivery methods</option>
          <option value="portal">Available here</option>
          <option value="email">Sent by email</option>
        </select>
      </div>

      {!isLoading && (
        <p className="files-count">
          Showing {visible.length} delivered order{visible.length === 1 ? '' : 's'}
        </p>
      )}

      {isLoading && <SkeletonRows rows={4} />}

      {!isLoading && visible.length === 0 && (
        <EmptyState
          icon="ti-folder"
          title={q ? 'No files match' : 'No delivered files yet'}
          description={
            q
              ? 'Try a different name or order number.'
              : 'Files appear here once an order is completed.'
          }
        />
      )}

      {!isLoading && paged.length > 0 && (
        <div className="card">
          <div className="table-wrap">
            <table className="itable">
              <thead>
                <tr>
                  <th>Project / Design</th>
                  <th>Order No.</th>
                  <th>Category</th>
                  <th>Files</th>
                  <th>Delivery Method</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paged.map((g) => {
                  const open = openKey === g.key;
                  const emailed = g.deliveredVia === 'EMAIL';
                  return (
                    <Fragment key={g.key}>
                      <tr
                        className="click-row"
                        onClick={() => setOpenKey(open ? null : g.key)}
                      >
                        <td>
                          <div className="on">{g.orderName ?? 'Order'}</div>
                          <div className="om">{dateShort(g.deliveredAt)}</div>
                        </td>
                        <td>{g.humanRef ?? g.orderId.slice(0, 6)}</td>
                        <td className="muted">{serviceCategoryLabel(g.serviceType)}</td>
                        <td>{g.files.length}</td>
                        <td>{deliveryMethodLabel(g.deliveredVia)}</td>
                        <td>
                          <i className={`ti ${open ? 'ti-chevron-up' : 'ti-chevron-down'}`} />
                        </td>
                      </tr>
                      {open && (
                        <tr className="expand-row">
                          <td colSpan={6}>
                            {emailed ? (
                              <div className="file-email-note">
                                <p>
                                  <i className="ti ti-mail" /> Final files sent by email
                                </p>
                                <p>
                                  {g.files.length} file{g.files.length === 1 ? '' : 's'} were sent to{' '}
                                  {maskEmail(g.deliveryEmail)}.
                                </p>
                                <Link to={`/portal/orders/${g.orderId}`} className="btn btn-ghost btn-sm">
                                  View order
                                </Link>
                              </div>
                            ) : (
                              <table className="itable file-inner">
                                <thead>
                                  <tr>
                                    <th>File Name</th>
                                    <th>Size</th>
                                    <th>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.files.map((f) => (
                                    <tr key={f.fileId}>
                                      <td>{f.originalName}</td>
                                      <td className="muted">{fileSizeLabel(f.byteSize)}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="btn btn-ghost btn-sm"
                                          onClick={() =>
                                            downloadSignedFile(
                                              myDeliveryFileUrl(f.orderId, f.fileId),
                                              f.originalName,
                                            )
                                          }
                                        >
                                          <i className="ti ti-download" /> Download
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={visible.length}
        onPage={setPage}
      />
    </div>
  );
}
