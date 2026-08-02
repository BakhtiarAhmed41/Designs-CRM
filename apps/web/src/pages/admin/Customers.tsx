import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  mergeCustomer,
  updateCustomer,
  type AccountType,
  type Customer,
  type CustomerInput,
  type CustomerSource,
  type NetTerms,
} from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { money, dateShort, statusChipClass, statusLabel } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';

type FilterId = '' | 'NET_MONTHLY' | 'PAY_PER_ORDER' | 'top';

const ACCOUNT_TYPES: Array<{ id: AccountType; label: string }> = [
  { id: 'PAY_PER_ORDER', label: 'Pay per order' },
  { id: 'NET_MONTHLY', label: 'Net monthly' },
];
const NET_TERMS: NetTerms[] = ['NET_15', 'NET_30'];
const SOURCES: CustomerSource[] = ['PORTAL', 'ETSY', 'GUEST', 'TEXT'];

function accountChip(type: AccountType) {
  return type === 'NET_MONTHLY' ? 'chip c-quote' : 'chip c-new';
}

function accountLabel(type: AccountType) {
  return type === 'NET_MONTHLY' ? 'Net monthly' : 'Pay per order';
}

export function AdminCustomers() {
  const [filter, setFilter] = useState<FilterId>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  const accountType =
    filter === 'NET_MONTHLY' || filter === 'PAY_PER_ORDER' ? filter : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-customers', accountType, q, page],
    queryFn: () =>
      listCustomers({
        accountType,
        q: q || undefined,
        page,
        pageSize: 20,
      }),
  });

  const customers = useMemo(() => {
    const list = data?.customers ?? [];
    if (filter === 'top') return [...list].sort((a, b) => (b.ltvCents ?? 0) - (a.ltvCents ?? 0));
    return list;
  }, [data?.customers, filter]);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>Customers</h1>
          <div className="sub">
            Every account with full history and lifetime value. Grant net-monthly terms here.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setShowMerge(true)}>
            <i className="ti ti-arrows-join" /> Merge duplicates
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
            <i className="ti ti-plus" /> Add customer
          </button>
        </div>
      </div>

      <ListToolbar
        search={q}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search customers by name, email, phone…"
      />

      <div style={{ margin: '0 0 10px' }}>
        <div className="filters">
          <button type="button" className={filter === '' ? 'on' : ''} onClick={() => setFilter('')}>
            All
          </button>
          <button
            type="button"
            className={filter === 'NET_MONTHLY' ? 'on' : ''}
            onClick={() => setFilter('NET_MONTHLY')}
          >
            Net-monthly
          </button>
          <button
            type="button"
            className={filter === 'PAY_PER_ORDER' ? 'on' : ''}
            onClick={() => setFilter('PAY_PER_ORDER')}
          >
            Pay per order
          </button>
          <button
            type="button"
            className={filter === 'top' ? 'on' : ''}
            onClick={() => setFilter('top')}
          >
            Top spenders
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading...</div>}
        {!isLoading && customers.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No customers match this filter.</div>
        )}
        {customers.map((c) => (
          <button
            key={c.id}
            type="button"
            className="crow"
            onClick={() => setSelectedId(c.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <div className={`othumb ${c.accountType === 'NET_MONTHLY' ? 'm' : ''}`}>
              {c.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="oinfo">
              <div className="on">{c.name}</div>
            <div className="om">
              <span>{c.email ?? 'No email'}</span>
              <span>{c.ordersCount} orders</span>
              <span>{c.runningOrders ?? 0} running</span>
              {c.netTerms && <span>{c.netTerms.replace('_', ' ')}</span>}
            </div>
          </div>
            <span className={accountChip(c.accountType)}>{accountLabel(c.accountType)}</span>
            <div className="oprice">
              {money(c.ltvCents)}
              {c.storeCreditCents > 0 && (
                <div style={{ fontSize: 11, color: 'var(--green)' }}>
                  {money(c.storeCreditCents)} credit
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
      <PaginationBar
        page={data?.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        total={data?.total ?? customers.length}
        onPage={setPage}
      />

      {selectedId && (
        <CustomerDetailModal
          id={selectedId}
          allCustomers={customers}
          onClose={() => setSelectedId(null)}
        />
      )}
      {showNew && <NewCustomerModal onClose={() => setShowNew(false)} />}
      {showMerge && (
        <MergeModal customers={customers} onClose={() => setShowMerge(false)} />
      )}
    </div>
  );
}

function CustomerDetailModal({
  id,
  allCustomers,
  onClose,
}: {
  id: string;
  allCustomers: Customer[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-customer', id],
    queryFn: () => getCustomer(id),
  });
  const customer = data?.customer;

  const [form, setForm] = useState<CustomerInput | null>(null);
  const effective: CustomerInput | null = form
    ? form
    : customer
      ? {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          accountType: customer.accountType,
          netTerms: customer.netTerms,
          source: customer.source,
        }
      : null;

  const save = useMutation({
    mutationFn: () => updateCustomer(id, effective ?? {}),
    onSuccess: () => {
      setForm(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ['admin-customer', id] });
      qc.invalidateQueries({ queryKey: ['admin-customers'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteCustomer(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-customers'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>{customer?.name ?? 'Customer'}</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {isLoading && <div>Loading...</div>}
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          {customer && effective && (
            <>
              <div className="stats" style={{ marginBottom: 16 }}>
                <div className="stats-grid">
                  <div className="sc">
                    <div className="scl">Orders</div>
                    <div className="scv">{customer.ordersCount}</div>
                  </div>
                  <div className="sc">
                    <div className="scl">Running</div>
                    <div className="scv">{customer.runningOrders ?? 0}</div>
                  </div>
                  <div className="sc">
                    <div className="scl">Lifetime value</div>
                    <div className="scv">{money(customer.ltvCents)}</div>
                  </div>
                  <div className="sc">
                    <div className="scl">Open invoices</div>
                    <div className="scv">{customer.openInvoicesCount}</div>
                  </div>
                </div>
              </div>
              {customer.userId && (
                <label
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 12,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={customer.loginStatus !== 'DISABLED'}
                    onChange={(e) =>
                      updateCustomer(id, { active: e.target.checked }).then(() =>
                        qc.invalidateQueries({ queryKey: ['admin-customer', id] }),
                      )
                    }
                  />
                  Login active ({customer.loginStatus ?? 'n/a'})
                </label>
              )}

              <div className="ff">
                <label>Name</label>
                <input
                  value={effective.name}
                  onChange={(e) => setForm({ ...effective, name: e.target.value })}
                />
              </div>
              <div className="ff">
                <label>Email</label>
                <input
                  value={effective.email ?? ''}
                  onChange={(e) => setForm({ ...effective, email: e.target.value || null })}
                />
              </div>
              <div className="ff">
                <label>Phone</label>
                <input
                  value={effective.phone ?? ''}
                  onChange={(e) => setForm({ ...effective, phone: e.target.value || null })}
                />
              </div>
              <div className="ff">
                <label>Account type</label>
                <select
                  value={effective.accountType}
                  onChange={(e) =>
                    setForm({ ...effective, accountType: e.target.value as AccountType })
                  }
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {effective.accountType === 'NET_MONTHLY' && (
                <div className="ff">
                  <label>Net terms</label>
                  <select
                    value={effective.netTerms ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...effective,
                        netTerms: (e.target.value || null) as NetTerms | null,
                      })
                    }
                  >
                    <option value="">—</option>
                    {NET_TERMS.map((n) => (
                      <option key={n} value={n}>
                        {n.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="ff">
                <label>Source</label>
                <select
                  value={effective.source}
                  onChange={(e) =>
                    setForm({ ...effective, source: e.target.value as CustomerSource })
                  }
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !effective.name.trim()}
                >
                  {save.isPending ? 'Saving…' : 'Save / edit'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    if (window.confirm('Delete this customer?')) remove.mutate();
                  }}
                  disabled={remove.isPending}
                >
                  Delete
                </button>
              </div>

              <div style={{ marginTop: 20 }}>
                <div className="card-h" style={{ border: 'none', padding: '0 0 8px' }}>
                  <span className="ct">Recent orders</span>
                </div>
                {customer.recentOrders.length === 0 && <div className="note">No orders yet.</div>}
                {customer.recentOrders.map((o) => (
                  <Link
                    key={o.id}
                    to={`/admin/orders/${o.id}`}
                    className="orow"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="oinfo">
                      <div className="on">{o.name ?? 'Order'}</div>
                      <div className="om">
                        <span>#{o.humanRef ?? o.id.slice(0, 6)}</span>
                        <span>{dateShort(o.createdAt)}</span>
                      </div>
                    </div>
                    <span className={statusChipClass(o.status as OrderStatus)}>
                      {statusLabel(o.status as OrderStatus)}
                    </span>
                    <div className="oprice">{money(o.priceCents, o.currency)}</div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NewCustomerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerInput>({
    name: '',
    email: null,
    phone: null,
    password: '',
    accountType: 'PAY_PER_ORDER',
    netTerms: null,
    source: 'PORTAL',
    active: true,
  });

  const create = useMutation({
    mutationFn: () => createCustomer(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-customers'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Add customer</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="ff">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="ff">
            <label>Number / phone</label>
            <input
              value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value || null })}
            />
          </div>
          <div className="ff">
            <label>Email</label>
            <input
              value={form.email ?? ''}
              onChange={(e) => setForm({ ...form, email: e.target.value || null })}
            />
          </div>
          <div className="ff">
            <label>Password (for portal login)</label>
            <input
              type="password"
              value={form.password ?? ''}
              onChange={(e) => setForm({ ...form, password: e.target.value || null })}
              minLength={6}
              placeholder="At least 6 characters"
            />
          </div>
          <div className="ff">
            <label>Account type</label>
            <select
              value={form.accountType}
              onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={form.active !== false}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active (can login)
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => create.mutate()}
            disabled={
              create.isPending ||
              !form.name.trim() ||
              (!!form.password && (form.password?.length ?? 0) < 6)
            }
          >
            {create.isPending ? 'Creating…' : 'Create customer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MergeModal({
  customers,
  onClose,
}: {
  customers: Customer[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState('');
  const [intoId, setIntoId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const merge = useMutation({
    mutationFn: () => mergeCustomer(sourceId, intoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-customers'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>Merge duplicates</span>
          <button type="button" className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-b">
          {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="note" style={{ marginBottom: 12 }}>
            <i className="ti ti-info-circle" /> Merges orders, invoices and messages into the target account.
          </div>
          <div className="ff">
            <label>Duplicate to remove</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Select…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ff">
            <label>Merge into</label>
            <select value={intoId} onChange={(e) => setIntoId(e.target.value)}>
              <option value="">Select…</option>
              {customers.filter((c) => c.id !== sourceId).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!sourceId || !intoId || merge.isPending}
            onClick={() => merge.mutate()}
          >
            {merge.isPending ? 'Merging…' : 'Merge accounts'}
          </button>
        </div>
      </div>
    </div>
  );
}
