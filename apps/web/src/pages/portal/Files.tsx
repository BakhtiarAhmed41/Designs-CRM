import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listMyFiles, type MyFile } from '@/lib/designs';
import { myDeliveryFileUrl } from '@/lib/orders';
import { downloadSignedFile } from '@/lib/api';
import { dateShort } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';

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
  const { data, isLoading } = useQuery({
    queryKey: ['my-files'],
    queryFn: listMyFiles,
    refetchInterval: 30000,
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

  return (
    <div>
      <div className="ph">
        <div>
          <h1>My Files</h1>
          <div className="sub">
            Every finished design we&apos;ve made you, in one place. Download any file, any format,
            anytime — no need to ask.
          </div>
        </div>
      </div>

      {isLoading && <div className="empty">Loading…</div>}

      {!isLoading && groups.length === 0 && (
        <div className="empty">
          <i className="ti ti-folder" />
          <p>No delivered files yet. They&apos;ll appear here once an order is completed.</p>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {groups.map((g) => {
          const chip = groupChip(g.files);
          return (
            <div key={g.orderId} className="card" style={{ padding: 18, marginBottom: 14 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                  Order #{g.humanRef ?? g.orderId.slice(0, 6)} — {g.orderName ?? 'Order'}
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
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="note">
        <i className="ti ti-info-circle" />
        Need an existing design in a different format? Open it and choose &quot;Add a format&quot; —
        we&apos;ll export it for you.
      </div>
    </div>
  );
}
