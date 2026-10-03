import { useState } from 'react';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { getErrorMessage } from '@/lib/api';
import type { Design } from '@/lib/designs';
import type { EditKind } from '@/lib/edits';

export function RevisionModal({
  orderRef,
  defaultDesignerId,
  designers,
  designs,
  initialNote = '',
  onClose,
  onSubmit,
}: {
  orderRef: string;
  defaultDesignerId: string;
  designers: Array<{ id: string; firstName: string | null; email: string; skills: string[] }>;
  designs: Design[];
  initialNote?: string;
  onClose: () => void;
  onSubmit: (data: {
    note: string;
    kind: EditKind;
    priceCents?: number | null;
    designIds?: string[];
    assignedDesignerId?: string | null;
  }) => Promise<void>;
}) {
  const [note, setNote] = useState(initialNote);
  const [kind, setKind] = useState<EditKind>('FREE');
  const [price, setPrice] = useState('');
  const [designerId, setDesignerId] = useState(defaultDesignerId);
  const [assignDesigner, setAssignDesigner] = useState(!!defaultDesignerId);
  const [designIds, setDesignIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const showPicker = designs.length > 1;

  const handleSubmit = async () => {
    if (!note.trim()) {
      setError('Describe what needs to change.');
      return;
    }
    if (showPicker && designIds.length === 0) {
      setError('Pick which designs need a revision.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({
        note: note.trim(),
        kind,
        priceCents:
          kind === 'PAID' && price ? Math.round(Number(price) * 100) : kind === 'PAID' ? 0 : null,
        designIds: showPicker ? designIds : designs[0] ? [designs[0].id] : [],
        assignedDesignerId: assignDesigner && designerId ? designerId : null,
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Create revision #{orderRef}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="note" style={{ marginTop: 0, marginBottom: 12 }}>
            <i className="ti ti-info-circle" /> Stays on this order. The customer keeps the old files
            until you publish new ones.
          </div>
          {showPicker && (
            <div className="ff">
              <label>Which designs</label>
              <div className="rev-picks">
                {designs.map((d) => (
                  <label key={d.id} className="rev-pick">
                    <input
                      type="checkbox"
                      checked={designIds.includes(d.id)}
                      onChange={() =>
                        setDesignIds((prev) =>
                          prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                        )
                      }
                    />
                    <span>
                      {d.name}
                      {d.placement ? <small>{d.placement}</small> : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="ff">
            <label>What needs to change</label>
            <textarea
              placeholder='e.g. resize eagle to 3", make text bolder for stitching'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              className={`btn btn-sm ${kind === 'FREE' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setKind('FREE')}
            >
              Free revision
            </button>
            <button
              type="button"
              className={`btn btn-sm ${kind === 'PAID' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setKind('PAID')}
            >
              Paid revision
            </button>
          </div>
          {kind === 'PAID' && (
            <div className="ff">
              <label>Revision price. Payment link goes out first.</label>
              <input
                type="number"
                step="0.01"
                placeholder="$"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          )}
          {designers.length > 0 && (
            <>
              <label className="rev-check">
                <input
                  type="checkbox"
                  checked={assignDesigner}
                  onChange={(e) => setAssignDesigner(e.target.checked)}
                />
                Assign to designer
              </label>
              {assignDesigner && (
                <SelectMenu
                  style={{ marginBottom: 12 }}
                  value={designerId}
                  onChange={setDesignerId}
                  options={[
                    { value: '', label: 'Choose designer' },
                    ...designers.map((d) => ({
                      value: d.id,
                      label: d.firstName ?? d.email,
                    })),
                  ]}
                />
              )}
            </>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={pending}
            onClick={() => void handleSubmit()}
          >
            <i className="ti ti-refresh" /> {pending ? 'Creating…' : 'Create revision'}
          </button>
        </div>
      </div>
    </div>
  );
}
