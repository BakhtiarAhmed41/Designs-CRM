import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyFiles, type MyFile } from '@/lib/designs';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { myDeliveryFileUrl, requestFormat } from '@/lib/orders';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { dateShort } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PaginationBar } from '@/components/lists/ListToolbar';

type Group = {
  key: string;
  orderId: string;
  orderName: string | null;
  humanRef: string | null;
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

function monthKey(iso: string) {
  const match = iso.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthHeading(key: string) {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function dayHeading(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Delivered';
  return `Delivered ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
}

export function PortalFiles() {
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('all');
  const [method, setMethod] = useState('all');
  const [page, setPage] = useState(1);
  const [formatFor, setFormatFor] = useState<MyFile | null>(null);
  const [formatValue, setFormatValue] = useState('');
  const [formatNote, setFormatNote] = useState('');
  const [formatMsg, setFormatMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-files'],
    queryFn: listMyFiles,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });
  const requestMut = useMutation({
    mutationFn: () =>
      requestFormat(formatFor!.orderId, {
        format: formatValue.trim(),
        deliveryFileId: formatFor!.fileId,
        note: formatNote.trim() || null,
      }),
    onSuccess: () => {
      setFormatMsg('Request sent. We’ll add the export to this library when it’s ready.');
      setFormatFor(null);
      void qc.invalidateQueries({ queryKey: ['my-files'] });
    },
    onError: (e) => setFormatMsg(getErrorMessage(e)),
  });

  const groups = useMemo<Group[]>(() => {
    const byOrder = new Map<string, Group>();
    for (const f of data?.files ?? []) {
      const g = byOrder.get(f.orderId);
      if (g) g.files.push(f);
      else {
        byOrder.set(f.orderId, {
          key: f.orderId,
          orderId: f.orderId,
          orderName: f.orderName,
          humanRef: f.humanRef,
          deliveredAt: f.deliveredAt,
          deliveredVia: f.deliveredVia ?? null,
          deliveryEmail: f.deliveryEmail ?? null,
          files: [f],
        });
      }
    }
    return Array.from(byOrder.values()).sort(
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
      if (month !== 'all' && monthKey(g.deliveredAt) !== month) return false;
      if (method === 'portal' && g.deliveredVia !== 'PORTAL') return false;
      if (method === 'email' && g.deliveredVia !== 'EMAIL') return false;
      if (!term) return true;
      return (
        (g.orderName ?? '').toLowerCase().includes(term) ||
        (g.humanRef ?? '').toLowerCase().includes(term) ||
        g.files.some((f) => f.originalName.toLowerCase().includes(term))
      );
    });
  }, [groups, q, month, method]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const paged = visible.slice((page - 1) * pageSize, page * pageSize);

  const sections = useMemo(() => {
    const monthsOut: Array<{ month: string | null; days: Array<{ heading: string; items: Group[] }> }> = [];
    for (const g of paged) {
      const monthLabel = month === 'all' ? monthHeading(monthKey(g.deliveredAt)) : null;
      const heading = dayHeading(g.deliveredAt);
      let monthBlock = monthsOut[monthsOut.length - 1];
      if (!monthBlock || monthBlock.month !== monthLabel) {
        monthBlock = { month: monthLabel, days: [] };
        monthsOut.push(monthBlock);
      }
      const lastDay = monthBlock.days[monthBlock.days.length - 1];
      if (lastDay && lastDay.heading === heading) lastDay.items.push(g);
      else monthBlock.days.push({ heading, items: [g] });
    }
    return monthsOut;
  }, [paged, month]);

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
            placeholder="Search by order number or name."
            aria-label="Search files"
          />
        </div>
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
        <p className="files-count">Showing {visible.length} delivered order{visible.length === 1 ? '' : 's'}</p>
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

      <div className="file-lib">
        {sections.map((monthBlock) => (
          <div key={monthBlock.month ?? 'selected-month'}>
            {monthBlock.month && <h2 className="file-month">{monthBlock.month}</h2>}
            {monthBlock.days.map((section) => (
              <div key={`${monthBlock.month ?? ''}-${section.heading}`}>
                <h3 className="file-day">{section.heading}</h3>
                {section.items.map((g) => {
                  const emailed = g.deliveredVia === 'EMAIL';
                  return (
                    <div key={g.orderId} className="file-group">
                      <div className="file-group-h">
                        <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                          {g.orderName ?? 'Order'} · #{g.humanRef ?? g.orderId.slice(0, 6)}
                        </span>
                        <span className="chip c-paid">{emailed ? 'Sent by email' : 'Available here'}</span>
                      </div>
                      {emailed ? (
                        <p className="file-email-note">
                          {g.files.length} file{g.files.length === 1 ? '' : 's'} sent to {maskEmail(g.deliveryEmail)} on{' '}
                          {dateShort(g.deliveredAt)}.
                        </p>
                      ) : (
                        <div className="fgrid">
                          {g.files.map((f) => (
                            <div key={f.fileId} className="fcard">
                              <div className={`fic${serviceThumbClass(f.formatLabel) ? ' m' : ''}`}>
                                <i className={`ti ${serviceTi(f.formatLabel ?? 'file')}`} />
                              </div>
                              <div className="fn">{f.originalName}</div>
                              <div className="fd">Delivered {dateShort(f.deliveredAt)}</div>
                              <div className="ftags">
                                {f.formatLabel && <span className="ftag">{f.formatLabel}</span>}
                              </div>
                              <button
                                type="button"
                                className="fbtn"
                                onClick={() =>
                                  downloadSignedFile(
                                    myDeliveryFileUrl(f.orderId, f.fileId),
                                    f.originalName,
                                  )
                                }
                              >
                                <i className="ti ti-download" /> Download
                              </button>
                              <button
                                type="button"
                                className="fbtn"
                                onClick={() => {
                                  setFormatFor(f);
                                  setFormatValue('');
                                  setFormatNote('');
                                }}
                              >
                                Add a format
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={visible.length}
        onPage={setPage}
      />

      {formatMsg && <div className="note">{formatMsg}</div>}
      {formatFor && (
        <div className="overlay open" onClick={() => setFormatFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <span>Request another format</span>
              <button type="button" className="modal-x" onClick={() => setFormatFor(null)}>
                &times;
              </button>
            </div>
            <div className="modal-b">
              <p className="muted" style={{ marginTop: 0 }}>
                {formatFor.originalName} · Order #{formatFor.humanRef ?? formatFor.orderId.slice(0, 6)}
              </p>
              <div className="ff">
                <label>Format</label>
                <input
                  value={formatValue}
                  onChange={(e) => setFormatValue(e.target.value)}
                  placeholder="DST, PES, SVG…"
                />
              </div>
              <div className="ff">
                <label>Note</label>
                <input
                  value={formatNote}
                  onChange={(e) => setFormatNote(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!formatValue.trim() || requestMut.isPending}
                onClick={() => requestMut.mutate()}
              >
                Send request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
