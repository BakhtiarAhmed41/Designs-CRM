import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listAdminEdits, updateAdminEdit, type EditRequest, type EditStatus } from '@/lib/edits';
import { listTeam } from '@/lib/team';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort, orderNumber, orderSlug } from '@/lib/format';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { freshOnOpen } from '@/lib/queryRefresh';
import { SkeletonRows } from '@/components/ui/Skeleton';

type FilterId = '' | EditStatus | 'FREE' | 'PAID' | 'IN_PROGRESS';

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: '', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'DONE', label: 'Done' },
  { id: 'FREE', label: 'Free' },
  { id: 'PAID', label: 'Paid' },
];

type DesignerOption = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  initials: string | null;
};

function designerLabel(d: Pick<DesignerOption, 'firstName' | 'lastName' | 'email'>) {
  return [d.firstName, d.lastName].filter(Boolean).join(' ') || d.email;
}

function designerInitials(d: DesignerOption) {
  if (d.initials?.trim()) return d.initials.trim().slice(0, 2).toUpperCase();
  const first = d.firstName?.[0] ?? d.email[0] ?? '?';
  const last = d.lastName?.[0] ?? '';
  return `${first}${last}`.toUpperCase();
}

function AssignMenu({
  designers,
  value,
  disabled,
  onChange,
}: {
  designers: DesignerOption[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = designers.find((d) => d.id === value) ?? null;

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;

    function place() {
      if (!menu || !button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.max(220, rect.width);
      menu.style.width = `${width}px`;
      const height = menu.offsetHeight;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const openUp = spaceBelow < height && rect.top > spaceBelow;
      let top = openUp ? rect.top - gap - height : rect.bottom + gap;
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
      let left = rect.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    }

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, designers.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const stop = (ev: { stopPropagation: () => void }) => ev.stopPropagation();

  return (
    <div className="edit-assign-wrap" onMouseDown={stop} onClick={stop}>
      <button
        ref={buttonRef}
        type="button"
        className={`edit-assign${open ? ' is-open' : ''}${selected ? ' is-set' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{selected ? designerLabel(selected) : 'Assign…'}</span>
        <i className="ti ti-chevron-down" aria-hidden />
      </button>
      {open && (
        <div ref={menuRef} className="edit-assign-menu" role="listbox" aria-label="Assign designer">
          {designers.length === 0 && <div className="edit-assign-empty">No designers yet</div>}
          {designers.map((d) => {
            const on = d.id === value;
            return (
              <button
                key={d.id}
                type="button"
                role="option"
                aria-selected={on}
                className={on ? 'is-on' : ''}
                onClick={() => {
                  setOpen(false);
                  if (!on) onChange(d.id);
                }}
              >
                <span className="edit-assign-av">{designerInitials(d)}</span>
                <span className="edit-assign-name">{designerLabel(d)}</span>
                {on && <i className="ti ti-check" aria-hidden />}
              </button>
            );
          })}
          {selected && (
            <>
              <div className="edit-assign-rule" />
              <button
                type="button"
                className="edit-assign-clear"
                onClick={() => {
                  setOpen(false);
                  onChange(null);
                }}
              >
                Clear assignment
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function sectionFor(e: EditRequest): 'waiting' | 'progress' | 'done' {
  if (e.status === 'DONE') return 'done';
  if (e.assignedDesignerId) return 'progress';
  return 'waiting';
}

export function AdminEdits() {
  const [filter, setFilter] = useState<FilterId>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const queryParams = useMemo(() => {
    const base = { q: q.trim() || undefined, page, pageSize: 20 };
    if (filter === 'FREE') return { ...base, kind: 'FREE' as const };
    if (filter === 'PAID') return { ...base, kind: 'PAID' as const };
    if (filter === 'IN_PROGRESS') {
      return { ...base, status: 'PENDING' as const, assigned: 'yes' as const };
    }
    if (filter === 'PENDING') {
      return { ...base, status: 'PENDING' as const, assigned: 'no' as const };
    }
    if (filter === 'DONE') return { ...base, status: 'DONE' as const };
    return base;
  }, [filter, q, page]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-edits', queryParams],
    queryFn: () => listAdminEdits(queryParams),
    ...freshOnOpen,
    refetchInterval: 30_000,
  });

  const teamQ = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
  });

  const designers = (teamQ.data?.members ?? []).filter((m) => m.role === 'DESIGNER');

  const edits = data?.edits ?? [];
  const totalPages = data?.totalPages ?? 1;

  const sections = useMemo(() => {
    const waiting = edits.filter((e) => sectionFor(e) === 'waiting');
    const progress = edits.filter((e) => sectionFor(e) === 'progress');
    const done = edits.filter((e) => sectionFor(e) === 'done');
    return [
      { key: 'waiting', title: 'Waiting on you', items: waiting },
      { key: 'progress', title: 'In progress', items: progress },
      { key: 'done', title: 'Done', items: done },
    ].filter((s) => s.items.length > 0 || (filter === '' && page === 1));
  }, [edits, filter, page]);

  return (
    <div>
      <PageHeader
        title="Revisions"
        subtitle="Waiting, in progress, and done. Assign a designer from the row."
      />

      <ListToolbar
        search={q}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search by order #, order name, customer…"
        status={filter === 'PENDING' || filter === 'DONE' ? filter : ''}
        onStatus={(v) => {
          setFilter((v as FilterId) || '');
          setPage(1);
        }}
        statusOptions={[
          { value: '', label: 'All statuses' },
          { value: 'PENDING', label: 'Pending' },
          { value: 'DONE', label: 'Done' },
        ]}
      />

      <div>
        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              className={filter === f.id ? 'on' : ''}
              onClick={() => {
                setFilter(f.id);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading && <SkeletonRows rows={5} />}
        {!isLoading && edits.length === 0 && (
          <EmptyState
            icon="ti-refresh"
            title="No revisions in this view"
            description="Revisions will appear here when customers ask for changes."
          />
        )}
        {sections.map((sec) => (
          <div key={sec.key}>
            <div className="date-head">
              {sec.title} <span className="dcount">{sec.items.length}</span>
            </div>
            {sec.items.map((e) => (
              <EditRow key={e.id} edit={e} designers={designers} />
            ))}
          </div>
        ))}
      </div>
      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={data?.total ?? edits.length}
        onPage={setPage}
      />
    </div>
  );
}

function EditRow({
  edit: e,
  designers,
}: {
  edit: EditRequest;
  designers: DesignerOption[];
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const section = sectionFor(e);

  const invalidate = () => {
    void invalidateWorkCaches(qc);
  };

  const markDone = useMutation({
    mutationFn: () => updateAdminEdit(e.id, { status: 'DONE' }),
    onSuccess: invalidate,
  });

  const assign = useMutation({
    mutationFn: (assignedDesignerId: string | null) =>
      updateAdminEdit(e.id, { assignedDesignerId }),
    onSuccess: invalidate,
  });

  const designer =
    e.designer?.firstName || e.designer?.initials
      ? ` · ${e.designer.firstName ?? e.designer.initials}`
      : '';

  const priceLabel = e.kind === 'PAID' && e.priceCents ? money(e.priceCents) : 'Free';
  const stopRow = (ev: { stopPropagation: () => void }) => ev.stopPropagation();

  return (
    <div
      className="orow edit-row"
      onClick={() => navigate(`/admin/orders/${orderSlug(e.orderRef, e.orderId)}`)}
    >
      <div className={`othumb ${e.kind === 'PAID' ? 'm' : ''}`}>
        <i className="ti ti-refresh" />
      </div>
      <div className="oinfo">
        <div className="on">{e.orderName ?? 'Revision'}</div>
        <div className="om">
          <span>{orderNumber(e.orderRef, e.orderId.slice(0, 6))}{designer}</span>
          <span className="item-date">{dateShort(e.createdAt)}</span>
        </div>
        {e.note ? (
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: 'var(--ink)',
              fontWeight: 400,
              whiteSpace: 'pre-wrap',
            }}
          >
            {e.note}
          </div>
        ) : (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>No note was added.</div>
        )}
      </div>
      <div className="edit-row-side">
        <div className={`oprice${priceLabel === 'Free' ? ' is-free' : ''}`}>{priceLabel}</div>
        <span
          className={`chip ${
            section === 'done' ? 'c-done' : section === 'progress' ? 'c-prog' : 'c-review'
          }`}
        >
          {section === 'done' ? 'Done' : section === 'progress' ? 'In progress' : 'Revision requested'}
        </span>
        {section !== 'done' && (
          <>
            <AssignMenu
              designers={designers}
              value={e.assignedDesignerId}
              disabled={assign.isPending}
              onChange={(id) => assign.mutate(id)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={markDone.isPending}
              onMouseDown={stopRow}
              onClick={(ev) => {
                ev.stopPropagation();
                markDone.mutate();
              }}
            >
              <i className="ti ti-check" /> Done
            </button>
          </>
        )}
      </div>
      {(markDone.isError || assign.isError) && (
        <span className="edit-row-error">{getErrorMessage(markDone.error ?? assign.error)}</span>
      )}
    </div>
  );
}
