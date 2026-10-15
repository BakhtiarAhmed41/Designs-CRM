import { SelectMenu } from '@/components/ui/SelectMenu';

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
        <SelectMenu
          size="compact"
          ariaLabel="Filter by status"
          value={status ?? ''}
          onChange={onStatus}
          options={statusOptions}
        />
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
  numbered = false,
  summary,
  ariaLabel = 'Pagination',
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
  numbered?: boolean;
  summary?: React.ReactNode;
  ariaLabel?: string;
}) {
  if (totalPages <= 1 && total <= 20 && !summary) return null;
  if (numbered) {
    const current = Math.max(1, Math.min(page, totalPages));
    const visible = totalPages <= 7
      ? Array.from({ length: totalPages }, (_, i) => i + 1)
      : [1, ...Array.from({ length: current <= 4 || current >= totalPages - 3 ? 5 : 3 }, (_, i) =>
        current <= 4 ? i + 1 : current >= totalPages - 3 ? totalPages - 4 + i : current - 1 + i), totalPages];
    const pages = [...new Set(visible)];
    return (
      <nav className="pager pager-numbered" aria-label={ariaLabel}>
        <span className="pager-summary" aria-live="polite">{summary ?? `${total} results`}</span>
        {totalPages > 1 && (
          <div className="pager-controls">
            <button type="button" className="pager-step" disabled={current <= 1} aria-label="Previous page" onClick={() => onPage(current - 1)}>
              <i className="ti ti-arrow-left" aria-hidden /><span>Previous</span>
            </button>
            <span className="pager-mobile-position" aria-label={`Page ${current} of ${totalPages}`}>{current} / {totalPages}</span>
            {pages.map((number, index) => (
              <span className="pager-page-item" key={number}>
                {index > 0 && number - pages[index - 1] > 1 && <span className="pager-ellipsis" aria-hidden>…</span>}
                <button type="button" className="pager-number" aria-label={`Page ${number}`} aria-current={number === current ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>
              </span>
            ))}
            <button type="button" className="pager-step" disabled={current >= totalPages} aria-label="Next page" onClick={() => onPage(current + 1)}>
              <span>Next</span><i className="ti ti-arrow-right" aria-hidden />
            </button>
          </div>
        )}
      </nav>
    );
  }
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
