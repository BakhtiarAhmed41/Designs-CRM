import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listAdminEdits, updateAdminEdit, type EditRequest, type EditStatus } from '@/lib/edits';
import { listTeam } from '@/lib/team';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort } from '@/lib/format';

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
  const statusFilter = filter === 'PENDING' || filter === 'DONE' ? filter : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-edits', statusFilter ?? ''],
    queryFn: () => listAdminEdits(statusFilter),
    refetchInterval: 30_000,
  });

  const teamQ = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
  });

  const designers = (teamQ.data?.members ?? []).filter((m) => m.role === 'DESIGNER');

  const edits = useMemo(() => {
    let list = data?.edits ?? [];
    if (filter === 'FREE') list = list.filter((e) => e.kind === 'FREE');
    if (filter === 'PAID') list = list.filter((e) => e.kind === 'PAID');
    if (filter === 'IN_PROGRESS') list = list.filter((e) => e.status === 'PENDING' && !!e.assignedDesignerId);
    if (filter === 'PENDING') list = list.filter((e) => e.status === 'PENDING' && !e.assignedDesignerId);
    return list;
  }, [data?.edits, filter]);

  const sections = useMemo(() => {
    const waiting = edits.filter((e) => sectionFor(e) === 'waiting');
    const progress = edits.filter((e) => sectionFor(e) === 'progress');
    const done = edits.filter((e) => sectionFor(e) === 'done');
    return [
      { key: 'waiting', title: 'Waiting on you', items: waiting },
      { key: 'progress', title: 'In progress', items: progress },
      { key: 'done', title: 'Done', items: done },
    ].filter((s) => s.items.length > 0 || filter === '');
  }, [edits, filter]);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Edits &amp; revisions</h1>
          <div className="sub">
            Every edit request ever — pending ones need action, done ones stay here as history.
          </div>
        </div>
      </div>

      <div style={{ margin: '16px 0 10px' }}>
        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              className={filter === f.id ? 'on' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>}
        {!isLoading && edits.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No edit requests match this filter.</div>
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
    qc.invalidateQueries({ queryKey: ['admin-edits'] });
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
        <div className="on">{e.orderName ?? 'Edit request'}</div>
        <div className="om">
          <span>
            #{e.orderRef ?? e.orderId.slice(0, 6)} · &quot;{e.note}&quot;{designer}
          </span>
          <span className="item-date">{dateShort(e.createdAt)}</span>
        </div>
      </div>
      <span
        className={`chip ${
          section === 'done' ? 'c-done' : section === 'progress' ? 'c-prog' : 'c-review'
        }`}
      >
        {section === 'done' ? 'Done' : section === 'progress' ? 'In progress' : 'Edit pending'}
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
