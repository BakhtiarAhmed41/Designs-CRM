import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listAdminEdits, updateAdminEdit, type EditRequest, type EditStatus } from '@/lib/edits';
import { listTeam } from '@/lib/team';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort } from '@/lib/format';
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
  designers: Array<{ id: string; email: string; firstName: string | null }>;
}) {
  const qc = useQueryClient();
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

  return (
    <Link
      to={`/admin/orders/${e.orderId}`}
      className="orow"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div className={`othumb ${e.kind === 'PAID' ? 'm' : ''}`}>
        <i className="ti ti-refresh" />
      </div>
      <div className="oinfo">
        <div className="on">{e.orderName ?? 'Revision'}</div>
        <div className="om">
          <span>#{e.orderRef ?? e.orderId.slice(0, 6)}{designer}</span>
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
      <span
        className={`chip ${
          section === 'done' ? 'c-done' : section === 'progress' ? 'c-prog' : 'c-review'
        }`}
      >
        {section === 'done' ? 'Done' : section === 'progress' ? 'In progress' : 'Revision requested'}
      </span>
      {section !== 'done' && (
        <div
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          onClick={(ev) => ev.preventDefault()}
        >
          <select
            className="stat-select"
            style={{ fontSize: 11, padding: '4px 8px', minWidth: 110 }}
            value={e.assignedDesignerId ?? ''}
            disabled={assign.isPending}
            onClick={(ev) => ev.stopPropagation()}
            onChange={(ev) => {
              ev.stopPropagation();
              assign.mutate(ev.target.value || null);
            }}
          >
            <option value="">Assign…</option>
            {designers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.firstName ?? d.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={markDone.isPending}
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              markDone.mutate();
            }}
          >
            <i className="ti ti-check" /> Done
          </button>
        </div>
      )}
      {(markDone.isError || assign.isError) && (
        <span style={{ fontSize: 11, color: 'var(--maroon)' }}>
          {getErrorMessage(markDone.error ?? assign.error)}
        </span>
      )}
      <div
        className="oprice"
        style={{
          fontSize: e.kind === 'FREE' && section !== 'done' ? 11 : undefined,
          color: e.kind === 'FREE' && section !== 'done' ? 'var(--faint)' : undefined,
          fontWeight: e.kind === 'FREE' && section !== 'done' ? 500 : undefined,
        }}
      >
        {e.kind === 'PAID' && e.priceCents ? money(e.priceCents) : 'Free'}
      </div>
    </Link>
  );
}
