import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyFiles, type MyFile } from '@/lib/designs';
import { myDeliveryFileUrl, requestFormat } from '@/lib/orders';
import { downloadSignedFile, getErrorMessage } from '@/lib/api';
import { dateShort } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';

type Group = {
  orderId: string;
  orderName: string | null;
  humanRef: string | null;
  files: MyFile[];
};

function groupChip(files: MyFile[]): { cls: string; label: string } {
  if (files.length === 0) return { cls: 'chip c-prog', label: 'In progress' };
  return { cls: 'chip c-paid', label: 'Delivered' };
}

export function PortalFiles() {
  const [q, setQ] = useState('');
  const [formatFor, setFormatFor] = useState<MyFile | null>(null);
  const [formatValue, setFormatValue] = useState('');
  const [formatNote, setFormatNote] = useState('');
  const [formatMsg, setFormatMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-files'],
    queryFn: listMyFiles,
    refetchInterval: 30000,
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
          orderId: f.orderId,
          orderName: f.orderName,
          humanRef: f.humanRef,
          files: [f],
        });
      }
    }
    return Array.from(byOrder.values());
  }, [data]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((g) => ({
        ...g,
        files: g.files.filter(
          (f) =>
            f.originalName.toLowerCase().includes(term) ||
            (g.orderName ?? '').toLowerCase().includes(term) ||
            (g.humanRef ?? '').toLowerCase().includes(term),
        ),
      }))
      .filter((g) => g.files.length > 0);
  }, [groups, q]);

  return (
    <div>
      <PageHeader
        title="My Files"
        subtitle="Every finished design in one library. Download any file, any time."
      />

      <div className="list-toolbar">
        <div className="searchbar" style={{ flex: 1, maxWidth: 420 }}>
          <i className="ti ti-search si" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search files or order #…"
            aria-label="Search files"
          />
        </div>
      </div>

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
        {visible.map((g) => {
          const chip = groupChip(g.files);
          return (
            <div key={g.orderId} className="file-group">
              <div className="file-group-h">
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                  Order #{g.humanRef ?? g.orderId.slice(0, 6)} · {g.orderName ?? 'Order'}
                </span>
                <span className={chip.cls}>{chip.label}</span>
              </div>
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
            </div>
          );
        })}
      </div>

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
