import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTopbarLead } from '@/components/Shell';
import { listMyFiles, type Design, type MyFile } from '@/lib/designs';
import { listMyEdits, type EditRequest } from '@/lib/edits';
import {
  designOptionLabel,
  embroideryDesigns,
  sizeDetail,
  type EmbDesign,
} from '@/lib/embroideryQuote';
import { freshOnOpen, whenVisible } from '@/lib/queryRefresh';
import { myDeliveryFilePreviewUrl, myDeliveryFileUrl, getMyOrder } from '@/lib/orders';
import { downloadSignedFile, getErrorMessage, resolveFileUrl } from '@/lib/api';
import { dateShort, deliveryMethodLabel, isImageFile, mergeDeliveredVia, money, orderNumber } from '@/lib/format';
import { studioQuotation, type QuoteWithLines } from '@/lib/quoteHelpers';
import { orderDeliveryGroups } from '@/lib/serviceOrderView';
import type { Order } from '@/lib/types';
import '@/styles/my-files.css';

type FilesOrder = Order & { designs?: Design[] };

type SizeBox = {
  key: string;
  title: string;
  spec: string;
  files: MyFile[];
  emailed: boolean;
};

type DesignSection = {
  name: string;
  boxes: SizeBox[];
};

type Group = {
  key: string;
  orderId: string;
  orderName: string | null;
  humanRef: string | null;
  deliveredAt: string;
  deliveredVia: string | null;
  files: MyFile[];
};

const EMPTY_FILES: MyFile[] = [];

function fileCount(files: MyFile[]) {
  const listed = files.filter((file) => !file.emailNotice);
  if (listed.length) return listed.length;
  return files.filter((file) => file.emailNotice).length;
}

function countLabel(count: number) {
  return `${count} file${count === 1 ? '' : 's'}`;
}

function fileSizeLabel(bytes?: number | null) {
  if (bytes == null || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isZipFile(file: MyFile) {
  if (file.isBundle) return true;
  const name = file.originalName.toLowerCase();
  return (
    name.endsWith('.zip') ||
    file.mimeType === 'application/zip' ||
    file.mimeType === 'application/x-zip-compressed'
  );
}

function isPreviewFile(file: MyFile) {
  if (file.emailNotice || file.isBundle) return false;
  return file.kind === 'PREVIEW' || isImageFile(file.originalName, file.mimeType);
}

function portalFiles(files: MyFile[]) {
  return files.filter((file) => !file.emailNotice);
}

function splitBundle(files: MyFile[]) {
  const real = portalFiles(files);
  const preview = real.filter(isPreviewFile);
  const previewIds = new Set(preview.map((file) => file.fileId));
  const zip = real.filter(
    (file) => isZipFile(file) && file.kind !== 'PREVIEW' && !previewIds.has(file.fileId),
  );
  const zipIds = new Set(zip.map((file) => file.fileId));
  const other = real.filter((file) => !previewIds.has(file.fileId) && !zipIds.has(file.fileId));
  return { preview, zip, other };
}

function batchEmailed(files: MyFile[]) {
  return files.some(
    (file) => file.emailNotice || file.batchVia === 'EMAIL' || file.batchVia === 'BOTH',
  );
}

function sizeSpec(title: string, index: number, rowCount: number, rowName: string, designs: EmbDesign[]) {
  const design = designs.find((item, itemIndex) => designOptionLabel(itemIndex, item.name) === title);
  const sizes = (design?.sizes ?? []).filter((size) => size.detail || size.placement || size.w || size.h);
  if (design && sizes.length === rowCount) {
    const size = sizes[index];
    const place = size?.placement?.trim();
    const detail = size ? sizeDetail(size) : '';
    const parts = [place, detail && detail !== 'Size' ? detail : ''].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  const name = rowName.trim();
  if (!name || name === title) return '';
  return name;
}

function groupByDesignName(files: MyFile[]): DesignSection[] {
  const map = new Map<string, MyFile[]>();
  for (const file of files) {
    const name = file.designName?.trim() || 'Files';
    const list = map.get(name) ?? [];
    list.push(file);
    map.set(name, list);
  }
  return [...map.entries()].map(([name, items]) => ({
    name,
    boxes: [
      {
        key: name,
        title: items.length && name !== 'Files' ? name : 'Files',
        spec: '',
        files: items,
        emailed: batchEmailed(items),
      },
    ],
  }));
}

function buildSections(order: FilesOrder | undefined, files: MyFile[]): DesignSection[] {
  const originals = files.filter((file) => !file.editId);
  const portal = portalFiles(originals);
  const looseEmail = originals.some((file) => file.emailNotice);

  if (!order) {
    if (portal.length) return groupByDesignName(portal);
    if (looseEmail) {
      return [{ name: 'Files', boxes: [{ key: 'email', title: 'Files', spec: '', files: [], emailed: true }] }];
    }
    return [];
  }

  const designs = embroideryDesigns(order.preferences, order.name);
  const lines = studioQuotation((order.quotations ?? []) as QuoteWithLines[])?.lines ?? [];
  const groups = orderDeliveryGroups(order, lines);
  const used = new Set<string>();

  let sections: DesignSection[] = groups.map((group) => ({
    name: group.title,
    boxes: group.rows.map((row, index) => {
      const matched = portal.filter((file) => file.designId && file.designId === row.design?.id);
      matched.forEach((file) => used.add(file.fileId));
      const spec = sizeSpec(group.title, index, group.rows.length, row.name, designs);
      const severalSizes = group.rows.length > 1;
      return {
        key: row.key,
        title: severalSizes ? `Size ${index + 1}` : spec || group.title,
        spec: severalSizes ? spec : '',
        files: matched,
        emailed: batchEmailed(matched),
      };
    }),
  }));

  if (looseEmail) {
    const filled = sections.flatMap((section) => section.boxes).filter((box) => box.files.length);
    const targets = filled.length ? filled : sections.flatMap((section) => section.boxes);
    targets.forEach((box) => {
      box.emailed = true;
    });
  }

  const leftover = portal.filter((file) => !used.has(file.fileId));
  const assigned = sections.some((section) => section.boxes.some((box) => box.files.length > 0 || box.emailed));

  if (!assigned) {
    if (leftover.length) return groupByDesignName(leftover);
    if (looseEmail && sections.length) return sections;
    if (looseEmail) {
      return [{ name: 'Files', boxes: [{ key: 'email', title: 'Files', spec: '', files: [], emailed: true }] }];
    }
    return sections;
  }

  sections = sections
    .map((section) => ({
      ...section,
      boxes: section.boxes.filter((box) => box.files.length > 0 || box.emailed),
    }))
    .filter((section) => section.boxes.length > 0);

  for (const extra of groupByDesignName(leftover)) {
    const existing = sections.find((section) => section.name === extra.name);
    if (existing) existing.boxes.push(...extra.boxes);
    else sections.push(extra);
  }
  return sections;
}

function Thumb({ file, index, onOpen }: { file: MyFile; index: number; onOpen: () => void }) {
  const src = file.previewUrl ? resolveFileUrl(file.previewUrl) : null;
  const [broken, setBroken] = useState(false);
  return (
    <button type="button" className="mf-thumb" aria-label={`View preview ${index + 1}`} onClick={onOpen}>
      {src && !broken ? (
        <img src={src} alt={`Preview ${index + 1}`} onError={() => setBroken(true)} />
      ) : (
        <i className="ti ti-photo" aria-hidden />
      )}
    </button>
  );
}

function FileRows({
  files,
  emailed,
  label,
  rowKey,
  empty,
  busyKey,
  onDownload,
  onPreview,
}: {
  files: MyFile[];
  emailed: boolean;
  label: string;
  rowKey: string;
  empty: string;
  busyKey: string | null;
  onDownload: (key: string, files: MyFile[]) => void;
  onPreview: (files: MyFile[], index: number, label: string) => void;
}) {
  const parts = splitBundle(files);
  const loose = parts.zip.some((file) => file.isBundle) ? [] : parts.other;
  if (parts.preview.length + parts.zip.length + loose.length === 0 && !emailed) {
    return <div className="mf-none">{empty}</div>;
  }

  const zipLabel = parts.zip.length === 1 ? fileSizeLabel(parts.zip[0].byteSize) : '';

  return (
    <>
      {parts.preview.length > 0 && (
        <div className="mf-fr">
          <span className="mf-ft preview">
            <i className="ti ti-photo" aria-hidden />
          </span>
          <div className="mf-fm">
            <b>Preview images</b>
            <span>{countLabel(parts.preview.length)}</span>
            <div className="mf-thumbs">
              {parts.preview.map((file, index) => (
                <Thumb
                  key={file.fileId}
                  file={file}
                  index={index}
                  onOpen={() => onPreview(parts.preview, index, label)}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            className="mf-dl"
            disabled={busyKey != null}
            onClick={() => onDownload(`${rowKey}:preview`, parts.preview)}
          >
            <i className="ti ti-download" aria-hidden /> Download
          </button>
        </div>
      )}
      {parts.zip.length > 0 && (
        <div className="mf-fr">
          <span className="mf-ft zip">
            <i className="ti ti-package" aria-hidden />
          </span>
          <div className="mf-fm">
            <b>ZIP file</b>
            <span>{zipLabel ? `${countLabel(parts.zip.length)} · ${zipLabel}` : countLabel(parts.zip.length)}</span>
          </div>
          <button
            type="button"
            className="mf-dl"
            disabled={busyKey != null}
            onClick={() => onDownload(`${rowKey}:zip`, parts.zip)}
          >
            <i className="ti ti-download" aria-hidden /> Download ZIP
          </button>
        </div>
      )}
      {loose.map((file) => {
        const size = fileSizeLabel(file.byteSize);
        return (
          <div key={file.fileId} className="mf-fr">
            <span className="mf-ft file">
              <i className="ti ti-file" aria-hidden />
            </span>
            <div className="mf-fm">
              <b>{file.originalName}</b>
              <span>{size || file.formatLabel || 'Design file'}</span>
            </div>
            <button
              type="button"
              className="mf-dl"
              disabled={busyKey != null}
              onClick={() => onDownload(`${rowKey}:${file.fileId}`, [file])}
            >
              <i className="ti ti-download" aria-hidden /> Download
            </button>
          </div>
        );
      })}
      {emailed && (
        <div className="mf-fr">
          <span className="mf-ft email">
            <i className="ti ti-send" aria-hidden />
          </span>
          <div className="mf-fm">
            <b>Sent by email</b>
            <span>ZIP with all files</span>
          </div>
          <span className="mf-ok">✓ Sent</span>
        </div>
      )}
    </>
  );
}

function PreviewModal({
  files,
  index,
  label,
  busy,
  onClose,
  onDownload,
}: {
  files: MyFile[];
  index: number;
  label: string;
  busy: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  const file = files[index];
  const src = file?.previewUrl ? resolveFileUrl(file.previewUrl) : null;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!file) return null;

  return createPortal(
    <div
      className="mf-ov"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mf-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${index + 1} of ${files.length}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mf-mh">
          <h2>
            Preview {index + 1} of {files.length}
          </h2>
          <button type="button" className="mf-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {src ? <img src={src} alt={`Preview ${index + 1}`} /> : <div className="mf-none">{file.originalName}</div>}
        <div className="mf-modal-sub">{label}</div>
        <div className="mf-modal-foot">
          <button type="button" className="mf-dl" disabled={busy} onClick={onDownload}>
            <i className="ti ti-download" aria-hidden /> Download
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function OrderFileDetail({
  orderId,
  group,
  listLoading,
  onBack,
  onDownloaded,
  onError,
}: {
  orderId: string;
  group?: Group;
  listLoading: boolean;
  onBack: () => void;
  onDownloaded: () => void;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<'files' | 'revs'>('files');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const [light, setLight] = useState<{ files: MyFile[]; index: number; label: string } | null>(null);

  const orderQ = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getMyOrder(orderId),
    ...freshOnOpen,
  });
  const editsQ = useQuery({
    queryKey: ['my-order-edits', orderId],
    queryFn: () => listMyEdits(orderId),
    ...freshOnOpen,
  });

  const order = orderQ.data?.order as FilesOrder | undefined;
  const files = group?.files ?? EMPTY_FILES;
  const number = orderNumber(order?.humanRef ?? group?.humanRef, orderId.slice(0, 6));
  const title = order?.name?.trim() || group?.orderName?.trim() || 'Order';
  const when = dateShort(order?.createdAt ?? group?.deliveredAt);
  const count = fileCount(files);

  const lead = useMemo(() => (number ? <b className="mf-crumb">{number}</b> : null), [number]);
  useTopbarLead(lead);

  useEffect(() => {
    document.querySelector('.workspace-col .main')?.scrollTo({ top: 0 });
  }, [orderId]);

  useEffect(() => {
    if (!toastOn) return;
    const timer = window.setTimeout(() => setToastOn(false), 2000);
    return () => window.clearTimeout(timer);
  }, [toastOn, toast]);

  const sections = useMemo(() => {
    if ((orderQ.isLoading && !order) || (listLoading && !group)) return null;
    return buildSections(order, files);
  }, [orderQ.isLoading, order, listLoading, group, files]);

  const edits = useMemo(
    () =>
      [...(editsQ.data?.edits ?? [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [editsQ.data?.edits],
  );
  const pending = edits.some((edit) => edit.status !== 'DONE');
  const multi = (sections?.length ?? 0) > 1;

  async function downloadFiles(key: string, batch: MyFile[]) {
    if (!batch.length || busyKey) return;
    setBusyKey(key);
    setToast('Preparing download…');
    setToastOn(true);
    try {
      for (const file of batch) {
        const previewOnly = file.kind === 'PREVIEW' || file.canDownload === false;
        await downloadSignedFile(
          previewOnly
            ? myDeliveryFilePreviewUrl(file.orderId, file.fileId)
            : myDeliveryFileUrl(file.orderId, file.fileId),
          file.originalName,
          { stayOnPage: true },
        );
      }
      setToast('Download started');
      setToastOn(true);
      onDownloaded();
    } catch (err) {
      setToastOn(false);
      onError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  function revisionFiles(edit: EditRequest) {
    return files.filter((file) => file.editId === edit.id);
  }

  return (
    <div className="mf-od">
      <button type="button" className="mf-back" onClick={onBack}>
        ← Back to My Files
      </button>
      <h1>{title}</h1>
      <div className="mf-metas">
        <span>
          Order <b>{number}</b>
        </span>
        {when && (
          <>
            <span className="mf-sep" />
            <span>Requested {when}</span>
          </>
        )}
        <span className="mf-sep" />
        <span>
          {count} file{count === 1 ? '' : 's'}
        </span>
      </div>

      {orderQ.isError && (
        <div className="alert-error" style={{ marginTop: 16 }}>
          {group
            ? 'Order details could not be loaded. Delivered files are still listed below.'
            : 'This order could not be opened.'}
        </div>
      )}

      {!editsQ.isLoading && edits.length > 0 && (
        <div className="mf-tabs" role="tablist" aria-label="Order files">
          <button
            type="button"
            className={`mf-tab${tab === 'files' ? ' on' : ''}`}
            role="tab"
            aria-selected={tab === 'files'}
            onClick={() => setTab('files')}
          >
            Order files
          </button>
          <button
            type="button"
            className={`mf-tab${tab === 'revs' ? ' on' : ''}`}
            role="tab"
            aria-selected={tab === 'revs'}
            onClick={() => setTab('revs')}
          >
            Revisions
            <em>{edits.length}</em>
            {pending && <span className="mf-pend" title="Revision in progress" />}
          </button>
        </div>
      )}

      {tab === 'revs' && edits.length > 0 ? (
        <div className="mf-grid">
          {edits.map((edit, index) => {
            const charged = edit.kind === 'PAID' && (edit.priceCents ?? 0) > 0;
            const paid = edit.invoiceStatus === 'PAID';
            const batch = revisionFiles(edit);
            const label = `${title} revision ${index + 1}`;
            return (
              <section key={edit.id} className="mf-box">
                <div className="mf-bh mf-rh">
                  <div>
                    <b>Revision {index + 1}</b>
                    {edit.note?.trim() && <span>{edit.note}</span>}
                  </div>
                  <div className="mf-act">
                    {charged ? (
                      <>
                        <b className="mf-price">{money(edit.priceCents, edit.currency ?? 'USD')}</b>
                        <span className={paid ? 'mf-pill paid' : 'mf-pill unpaid'}>{paid ? 'Paid' : 'Unpaid'}</span>
                      </>
                    ) : (
                      <span className="mf-free">Free revision</span>
                    )}
                    <span className={edit.status === 'DONE' ? 'mf-st done' : 'mf-st wait'}>
                      {edit.status === 'DONE' ? '✓ Delivered' : '● Revision requested'}
                    </span>
                  </div>
                </div>
                <FileRows
                  files={batch}
                  emailed={batchEmailed(batch)}
                  label={label}
                  rowKey={edit.id}
                  empty="Files will appear here once this revision is published."
                  busyKey={busyKey}
                  onDownload={(key, batchFiles) => void downloadFiles(key, batchFiles)}
                  onPreview={(previewFiles, previewIndex, previewLabel) =>
                    setLight({ files: previewFiles, index: previewIndex, label: previewLabel })
                  }
                />
              </section>
            );
          })}
        </div>
      ) : (
        <>
          {(listLoading || orderQ.isLoading) && !sections && (
            <div className="mf-grid-skel" aria-busy="true" aria-label="Loading files">
              <div className="mf-box-skel" />
              <div className="mf-box-skel" />
            </div>
          )}
          {sections && sections.length === 0 && !listLoading && (
            <div className="mf-grid">
              <section className="mf-box">
                <div className="mf-none">No order files yet.</div>
              </section>
            </div>
          )}
          {sections?.map((section, sectionIndex) => (
            <div key={`${section.name}-${sectionIndex}`}>
              {multi && <h3 className="mf-gh">{section.name}</h3>}
              <div className="mf-grid">
                {section.boxes.map((box) => {
                  const label = [section.name, box.title, box.spec].filter(Boolean).join(' · ');
                  return (
                    <section key={box.key} className="mf-box">
                      <div className="mf-bh">
                        <b>{box.title}</b>
                        {box.spec && <span>{box.spec}</span>}
                      </div>
                      <FileRows
                        files={box.files}
                        emailed={box.emailed}
                        label={label}
                        rowKey={box.key}
                        empty="Files will appear here once they are published."
                        busyKey={busyKey}
                        onDownload={(key, batchFiles) => void downloadFiles(key, batchFiles)}
                        onPreview={(previewFiles, previewIndex, previewLabel) =>
                          setLight({ files: previewFiles, index: previewIndex, label: previewLabel })
                        }
                      />
                    </section>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      <p className="mf-note">
        Sent by email means a ZIP file with all your files was also sent to your email address. For a question
        about a design, message us from <Link to="/portal/messages">Messages</Link>.
      </p>

      {light && (
        <PreviewModal
          files={light.files}
          index={light.index}
          label={light.label}
          busy={busyKey != null}
          onClose={() => setLight(null)}
          onDownload={() => {
            const file = light.files[light.index];
            if (file) void downloadFiles(`light:${file.fileId}`, [file]);
          }}
        />
      )}
      <div className={`mf-toast${toastOn ? ' show' : ''}`} role="status">
        {toast}
      </div>
    </div>
  );
}

export function PortalFiles() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusOrder = searchParams.get('order');
  const [q, setQ] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['my-files'],
    queryFn: listMyFiles,
    ...freshOnOpen,
    refetchInterval: whenVisible(30_000),
  });

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Group>();
    for (const file of data?.files ?? []) {
      const key = file.orderId;
      const existing = byKey.get(key);
      if (existing) {
        existing.files.push(file);
        existing.deliveredVia = mergeDeliveredVia([existing.deliveredVia, file.deliveredVia]);
        if (new Date(file.deliveredAt).getTime() > new Date(existing.deliveredAt).getTime()) {
          existing.deliveredAt = file.deliveredAt;
        }
      } else {
        byKey.set(key, {
          key,
          orderId: file.orderId,
          orderName: file.orderName,
          humanRef: file.humanRef,
          deliveredAt: file.deliveredAt,
          deliveredVia: file.deliveredVia ?? null,
          files: [file],
        });
      }
    }
    return Array.from(byKey.values()).sort(
      (a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime(),
    );
  }, [data]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^#/, '');
    if (!term) return groups;
    return groups.filter((group) => {
      const hay = [
        group.orderName,
        group.humanRef,
        group.orderId,
        orderNumber(group.humanRef, ''),
        deliveryMethodLabel(group.deliveredVia),
        ...group.files.map((file) => file.originalName),
        ...group.files.map((file) => file.designName),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [groups, q]);

  const selected = focusOrder ? groups.find((group) => group.orderId === focusOrder) : undefined;

  return (
    <div className="portal-files-page mf">
      {fileError && (
        <div className="alert-error" style={{ marginBottom: 0 }}>
          {fileError}
        </div>
      )}
      {isError && !focusOrder && (
        <div className="alert-error" style={{ marginBottom: 0 }}>
          Could not load your files. Refresh the page to try again.
        </div>
      )}

      {focusOrder ? (
        <OrderFileDetail
          key={focusOrder}
          orderId={focusOrder}
          group={selected}
          listLoading={isLoading}
          onBack={() => {
            setFileError(null);
            setSearchParams({});
          }}
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
          <div className="mf-card">
            <div className="mf-lt">
              <div>
                <h2>My Files</h2>
                <div className="mf-sub">Find and download files delivered with your completed orders.</div>
              </div>
              <input
                className="mf-search"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search by order number or name"
                aria-label="Search by order number or name"
                type="search"
              />
            </div>
            {isLoading && (
              <div aria-busy="true" aria-label="Loading files">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="mf-skel-row" />
                ))}
              </div>
            )}
            {!isLoading && (
              <div className="mf-scroll">
                <div className="mf-table">
                  <div className="mf-head">
                    <span />
                    <span>Order no.</span>
                    <span>Project / design</span>
                    <span>Files</span>
                    <span>Delivery method</span>
                    <span>Date</span>
                    <span />
                  </div>
                  {visible.length === 0 && (
                    <div className="mf-empty">
                      {q.trim()
                        ? 'No orders found.'
                        : 'No delivered files yet. Files appear here once an order is completed.'}
                    </div>
                  )}
                  {visible.map((group) => {
                    const number = orderNumber(group.humanRef, group.orderId.slice(0, 6));
                    const name = group.orderName?.trim() || 'Order';
                    return (
                      <div
                        key={group.key}
                        className="mf-row"
                        role="link"
                        tabIndex={0}
                        aria-label={`${number} ${name}`}
                        onClick={() => {
                          setFileError(null);
                          setSearchParams({ order: group.orderId });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            setFileError(null);
                            setSearchParams({ order: group.orderId });
                          }
                        }}
                      >
                        <span className="mf-oi">
                          <i className="ti ti-folder" aria-hidden />
                        </span>
                        <b className="mf-onum">{number}</b>
                        <b className="mf-pn">{name}</b>
                        <span>{fileCount(group.files)}</span>
                        <span className="mf-mute">{deliveryMethodLabel(group.deliveredVia)}</span>
                        <span className="mf-mute">{dateShort(group.deliveredAt)}</span>
                        <span className="mf-chv" aria-hidden>
                          ›
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {!isLoading && (
            <p className="mf-count">
              Showing {visible.length} delivered order{visible.length === 1 ? '' : 's'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
