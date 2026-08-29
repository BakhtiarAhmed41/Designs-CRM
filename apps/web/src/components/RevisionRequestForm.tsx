import type { Design } from '@/lib/designs';

export function RevisionRequestForm({
  designs,
  note,
  onNote,
  selectedIds,
  onToggle,
  onCancel,
  onSubmit,
  pending,
}: {
  designs: Design[];
  note: string;
  onNote: (value: string) => void;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCancel: () => void;
  onSubmit: (designIds: string[]) => void;
  pending: boolean;
}) {
  const pickable = designs.filter((d) => d.status === 'DELIVERED' || designs.length === 1);
  const choices = pickable.length > 0 ? pickable : designs;
  const showPicker = choices.length > 1;
  const effectiveIds = showPicker ? selectedIds : choices[0] ? [choices[0].id] : [];
  const canSend = Boolean(note.trim()) && (!showPicker || selectedIds.length > 0);

  return (
    <div
      style={{
        borderTop: '0.5px solid var(--line)',
        paddingTop: 12,
        marginTop: 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {showPicker && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
            Which designs need a revision?
          </div>
          {choices.map((d) => (
            <label
              key={d.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                marginBottom: 6,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(d.id)}
                onChange={() => onToggle(d.id)}
              />
              {d.name}
              {d.placement ? ` (${d.placement})` : ''}
            </label>
          ))}
        </div>
      )}
      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>
        What should we change?
      </label>
      <textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="Describe the revision you need…"
        rows={3}
        style={{
          width: '100%',
          border: '0.5px solid var(--line)',
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canSend || pending}
          onClick={() => onSubmit(effectiveIds)}
        >
          {pending ? 'Sending…' : 'Submit revision request'}
        </button>
      </div>
    </div>
  );
}
