export function InboxBulkBar({
  selectedCount,
  totalCount,
  onToggleAll,
  onDelete,
  deleting,
}: {
  selectedCount: number;
  totalCount: number;
  onToggleAll: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  return (
    <div className="inbox-bulk">
      <label className="inbox-check">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={totalCount === 0}
          onChange={onToggleAll}
          aria-label={allSelected ? 'Unselect all' : 'Select all'}
        />
      </label>
      {selectedCount > 0 ? (
        <>
          <button
            type="button"
            className="inbox-bulk-btn"
            disabled={deleting}
            onClick={onDelete}
          >
            <i className="ti ti-trash" />
            Trash
          </button>
          <span className="inbox-bulk-count">{selectedCount} selected</span>
        </>
      ) : (
        <span className="inbox-bulk-count">Select chats</span>
      )}
    </div>
  );
}

export function HelpRequestBadge() {
  return <span className="mlabel lbl-help">Help request</span>;
}

export function InboxStarButton({
  on,
  onClick,
}: {
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`inbox-star${on ? ' on' : ''}`}
      aria-label={on ? 'Remove star' : 'Star as important'}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <path
          d="M12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z"
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
