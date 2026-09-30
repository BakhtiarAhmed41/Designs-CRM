import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyFiles, type MyFile } from '@/lib/designs';
import { listMyEdits, type EditRequest } from '@/lib/edits';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { myDeliveryFileUrl } from '@/lib/orders';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { dateShort, deliveryMethodLabel, isImageFile, mergeDeliveredVia, money, orderNumber } from '@/lib/format';
import { serviceCategoryLabel } from '@/lib/serviceIcon';
import { DeliveryPreview } from '@/components/FilePreview';
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
  files: MyFile[];
};

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

function splitFiles(files: MyFile[]) {
  const real = files.filter((file) => !file.emailNotice);
  const preview = real.filter(
    (file) => !file.isBundle && (file.kind === 'PREVIEW' || isImageFile(file.originalName, file.mimeType)),
  );
  const zip = real.filter((file) => file.isBundle && file.kind !== 'PREVIEW');
  const previewIds = new Set(preview.map((file) => file.fileId));
  const download = real.filter((file) => !file.isBundle && file.kind !== 'PREVIEW' && !previewIds.has(file.fileId));
  return { preview, zip, download };
}

function OrderFileDetail({
  orderId,
  group,
  onBack,
  onDownloaded,
  onError,
}: {
  orderId: string;
  group?: Group;
  onBack: () => void;
  onDownloaded: () => void;
  onError: (message: string) => void;
}) {
  const editsQ = useQuery({
    queryKey: ['my-order-edits', orderId],
    queryFn: () => listMyEdits(orderId),
    ...freshOnOpen,
  });
  const files = group?.files ?? [];
  const listed = files.filter((file) => !file.emailNotice);
  const edits = editsQ.data?.edits ?? [];
  const orderFiles = listed.filter((file) => !file.editId);
  const emailed = files.some(
    (file) => file.emailNotice || file.deliveredVia === 'EMAIL' || file.deliveredVia === 'BOTH',
  );
  const byDesign = new Map<string, MyFile[]>();
  for (const file of orderFiles) {
    const name = file.designName?.trim() || 'Files';
    const bucket = byDesign.get(name) ?? [];
    bucket.push(file);
    byDesign.set(name, bucket);
  }

  function download(file: MyFile) {
    void downloadSignedFile(myDeliveryFileUrl(file.orderId, file.fileId), file.originalName, {
      stayOnPage: true,
    })
      .then(() => onDownloaded())
      .catch((err) => onError(getErrorMessage(err)));
  }

  return (
    <div>
      <button type="button" className="files-back" onClick={onBack}>
        ← Back to My Files
      </button>
      <div className="card files-order-head">
        <h2>{group?.orderName?.trim() || 'Order'}</h2>
        <div className="files-metas">
          <span>
            Order <b>{orderNumber(group?.humanRef, orderId.slice(0, 6))}</b>
          </span>
          {group?.deliveredAt && <span>Delivered {dateShort(group.deliveredAt)}</span>}
          <span>
            {listed.length} file{listed.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <h2 className="files-sec">Revision request files</h2>
      <div className="card">
        {edits.length === 0 && <div className="files-empty">No revision requests for this order.</div>}
        {edits.map((edit, index) => (
          <RevisionFiles
            key={edit.id}
            edit={edit}
            index={index}
            files={files.filter((file) => file.editId === edit.id)}
            onDownload={download}
          />
        ))}
      </div>

      <h2 className="files-sec">Order files</h2>
      <div className="card">
        {byDesign.size === 0 && !emailed && <div className="files-empty">No order files yet.</div>}
        {byDesign.size === 0 && emailed && (
          <div className="files-line">
            <span className="files-kind email">Email</span>
            <span className="files-st done">Sent by email · ZIP with all files</span>
          </div>
        )}
        {[...byDesign.entries()].map(([name, items]) => (
          <div key={name} className="files-block">
            <div className="files-group">{name}</div>
            <FileLines
              files={items}
              emailed={items.some((file) => file.deliveredVia === 'EMAIL' || file.deliveredVia === 'BOTH')}
              onDownload={download}
            />
          </div>
        ))}
      </div>

      <div className="card files-help">
        <h3>Helpful to know</h3>
        <ul>
          <li>
            Each size can be delivered in more than one way: <b>Preview</b> files, a <b>ZIP file</b>, or by <b>email</b>.
          </li>
          <li>
            <b>Delivered by email</b> means a ZIP file containing all your files was also sent to your email address.
          </li>
          <li>For a question about a design, contact us from Messages.</li>
        </ul>
      </div>
    </div>
  );
}

function RevisionFiles({
  edit,
  index,
  files,
  onDownload,
}: {
  edit: EditRequest;
  index: number;
  files: MyFile[];
  onDownload: (file: MyFile) => void;
}) {
  const charged = edit.kind === 'PAID' && (edit.priceCents ?? 0) > 0;
  const paid = edit.invoiceStatus === 'PAID';
  const portalFiles = files.filter((file) => !file.emailNotice);
  const emailed = files.some(
    (file) =>
      file.emailNotice || file.batchVia === 'EMAIL' || file.batchVia === 'BOTH',
  );
  return (
    <div className="files-block">
      <div className="files-rev-h">
        <div>
          <b>Revision {index + 1}</b>
          <span>{edit.note}</span>
        </div>
        <div className="files-rev-meta">
          {charged ? (
            <>
              <b>{money(edit.priceCents, edit.currency ?? 'USD')}</b>
              <span className={paid ? 'files-pill paid' : 'files-pill unpaid'}>{paid ? 'Paid' : 'Unpaid'}</span>
            </>
          ) : (
            <span className="files-free">Free revision</span>
          )}
          <span className={edit.status === 'DONE' ? 'files-st done' : 'files-st wait'}>
            {edit.status === 'DONE' ? '✓ Delivered' : '● Revision requested'}
          </span>
        </div>
      </div>
      {portalFiles.length === 0 && !emailed ? (
        <div className="files-empty">Files will appear here once this revision is published.</div>
      ) : (
        <FileLines
          files={portalFiles}
          emailed={emailed}
          onDownload={onDownload}
        />
      )}
    </div>
  );
}

function FileLines({
  files,
  emailed = false,
  onDownload,
}: {
  files: MyFile[];
  emailed?: boolean;
  onDownload: (file: MyFile) => void;
}) {
  const parts = splitFiles(files);
  const showDownload = parts.zip.length === 0 ? parts.download : [];
  if (parts.preview.length + parts.zip.length + showDownload.length === 0 && !emailed) return null;
  return (
    <div className="files-lines">
      {parts.preview.length > 0 && (
        <div className="files-line files-line-preview">
          <div className="files-line-main">
            <span className="files-kind preview">Preview</span>
            <span>
              {parts.preview.length} file{parts.preview.length === 1 ? '' : 's'}
            </span>
            <span className="files-st done">View only</span>
          </div>
          <div className="files-thumbs">
            {parts.preview.map((file) => (
              <DeliveryPreview
                key={file.fileId}
                orderId={file.orderId}
                fileId={file.fileId}
                name={file.originalName}
                mimeType={file.mimeType}
                previewUrl={file.previewUrl}
                safe
              />
            ))}
          </div>
        </div>
      )}
      {parts.zip.map((file) => (
        <div key={file.fileId} className="files-line">
          <span className="files-kind zip">ZIP file</span>
          <span>
            {file.originalName}
            <em>{fileSizeLabel(file.byteSize)}</em>
          </span>
          <button type="button" className="btn btn-sm files-dl" onClick={() => onDownload(file)}>
            <i className="ti ti-download" /> Download ZIP
          </button>
        </div>
      ))}
      {showDownload.map((file) => (
        <div key={file.fileId} className="files-line">
          <span className="files-kind zip">File</span>
          <span>
            {file.originalName}
            {(file.downloadCount ?? 0) === 0 && <em className="file-new">NEW</em>}
            <em>{fileSizeLabel(file.byteSize)}</em>
          </span>
          <button type="button" className="btn btn-sm files-dl" onClick={() => onDownload(file)}>
            <i className="ti ti-download" /> Download
          </button>
        </div>
      ))}
      {emailed && (
        <div className="files-line">
          <span className="files-kind email">Email</span>
          <span className="files-st done">Sent by email · ZIP with all files</span>
        </div>
      )}
    </div>
  );
}

export function PortalFiles() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusOrder = searchParams.get('order');
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [method, setMethod] = useState('all');
  const [page, setPage] = useState(1);
  const [fileError, setFileError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-files'],
    queryFn: listMyFiles,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Group>();
    for (const f of data?.files ?? []) {
      const key = f.orderId;
      const g = byKey.get(key);
      if (g) {
        g.files.push(f);
        g.deliveredVia = mergeDeliveredVia([g.deliveredVia, f.deliveredVia]);
        if (new Date(f.deliveredAt).getTime() > new Date(g.deliveredAt).getTime()) {
          g.deliveredAt = f.deliveredAt;
        }
      } else {
        byKey.set(key, {
          key,
          orderId: f.orderId,
          orderName: f.orderName,
          humanRef: f.humanRef,
          serviceType: f.serviceType ?? null,
          deliveredAt: f.deliveredAt,
          deliveredVia: f.deliveredVia ?? null,
          files: [f],
        });
      }
    }
    return Array.from(byKey.values()).sort(
      (a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime(),
    );
  }, [data]);

  const months = useMemo(() => {
    const keys = new Set(groups.flatMap((g) => g.files.map((file) => monthKey(file.deliveredAt))));
    return Array.from(keys);
  }, [groups]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return groups.filter((g) => {
      const days = g.files.map((file) => dayKey(file.deliveredAt));
      if (month !== 'all' && !days.some((day) => monthKey(day) === month)) return false;
      if (dateFrom && days.every((day) => day < dateFrom)) return false;
      if (dateTo && days.every((day) => day > dateTo)) return false;
      if (method === 'portal' && g.deliveredVia !== 'PORTAL' && g.deliveredVia !== 'BOTH') return false;
      if (method === 'email' && g.deliveredVia !== 'EMAIL' && g.deliveredVia !== 'BOTH') return false;
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

  const selected = focusOrder ? groups.find((group) => group.orderId === focusOrder) : undefined;

  return (
    <div>
      <PageHeader
        title="My Files"
        subtitle="Find and download files delivered with your completed orders."
      />

      {fileError && (
        <div className="alert-error" style={{ marginBottom: 12 }}>
          {fileError}
        </div>
      )}

      {focusOrder ? (
        <OrderFileDetail
          orderId={focusOrder}
          group={selected}
          onBack={() => setSearchParams({})}
          onDownloaded={() => {
            setFileError(null);
            void qc.invalidateQueries({ queryKey: ['my-files'] });
            void qc.invalidateQueries({ queryKey: ['my-activity'] });
            void qc.invalidateQueries({ queryKey: ['notifications'] });
          }}
          onError={setFileError}
        />
      ) : (
      <>
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
          <option value="portal">Files delivered on portal</option>
          <option value="email">Files delivered by email</option>
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
            <table className="itable file-orders">
              <thead>
                <tr>
                  <th>Order no.</th>
                  <th>Project / design</th>
                  <th>Files</th>
                  <th>Delivery method</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
              {paged.map((g) => {
                const emailed = g.deliveredVia === 'EMAIL' || g.deliveredVia === 'BOTH';
                const listed = g.files.filter((f) => !f.emailNotice);
                return (
                    <tr
                      key={g.key}
                      className="click-row"
                      tabIndex={0}
                      onClick={() => setSearchParams({ order: g.orderId })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setSearchParams({ order: g.orderId });
                      }}
                    >
                      <td><b>{orderNumber(g.humanRef, g.orderId.slice(0, 6))}</b></td>
                      <td>
                        <div className="on">{g.orderName ?? 'Order'}</div>
                      </td>
                      <td>{listed.length || (emailed ? 'Email' : 0)}</td>
                      <td className="muted">{deliveryMethodLabel(g.deliveredVia)}</td>
                      <td className="muted">{dateShort(g.deliveredAt)}</td>
                      <td>
                        <i className="ti ti-chevron-right" />
                      </td>
                    </tr>
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
      </>
      )}
    </div>
  );
}
