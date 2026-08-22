type Props = {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  status?: string;
  onStatus?: (v: string) => void;
  statusOptions?: Array<{ value: string; label: string }>;
  dateFrom?: string;
  dateTo?: string;
  onDateFrom?: (v: string) => void;
  onDateTo?: (v: string) => void;
  children?: React.ReactNode;
};

export function ListToolbar({
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  status,
  onStatus,
  statusOptions,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
  children,
}: Props) {
  return (
    <div className="list-toolbar">
      <div className="searchbar" style={{ flex: '1 1 220px', maxWidth: 360 }}>
        <i className="ti ti-search si" aria-hidden />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
      </div>
      {statusOptions && onStatus && (
        <select
          value={status ?? ''}
          onChange={(e) => onStatus(e.target.value)}
          aria-label="Filter by status"
        >
          {statusOptions.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {onDateFrom && onDateTo && (
        <>
          <input
            type="date"
            value={dateFrom ?? ''}
            onChange={(e) => onDateFrom(e.target.value)}
            aria-label="From date"
          />
          <span style={{ color: 'var(--faint)', fontSize: 12 }}>to</span>
          <input
            type="date"
            value={dateTo ?? ''}
            onChange={(e) => onDateTo(e.target.value)}
            aria-label="To date"
          />
        </>
      )}
      {children}
    </div>
  );
}

export function PaginationBar({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1 && total <= 20) return null;
  return (
    <div className="pager">
      <span>
        {total} result{total === 1 ? '' : 's'} · page {page} of {totalPages}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
