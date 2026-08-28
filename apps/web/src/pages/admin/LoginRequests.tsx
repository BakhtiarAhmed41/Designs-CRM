import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveLoginRequest,
  deleteLoginRequest,
  listLoginRequests,
} from '@/lib/auth';
import { getErrorMessage } from '@/lib/api';
import { dateShort } from '@/lib/format';
import { useState } from 'react';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PaginationBar } from '@/components/lists/ListToolbar';
import { useAuth } from '@/context/AuthContext';

export function AdminLoginRequests() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canDecide = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['login-requests'],
    queryFn: listLoginRequests,
    refetchInterval: 20_000,
  });
  const requests = data?.requests ?? [];
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(requests.length / pageSize));
  const paged = requests.slice((page - 1) * pageSize, page * pageSize);

  const approve = useMutation({
    mutationFn: (id: string) => approveLoginRequest(id),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['login-requests'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteLoginRequest(id),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['login-requests'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Login requests"
        subtitle="Approve new customer accounts so they can sign in."
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="card">
        {isLoading && <div style={{ padding: 16, color: 'var(--muted)' }}>Loading…</div>}
        {!isLoading && requests.length === 0 && (
          <EmptyState
            icon="ti-user-check"
            title="No pending requests"
            description="New registrations will appear here after email verification."
          />
        )}
        {requests.length > 0 && (
        <div className="table-wrap">
        <table className="qtable">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Requested</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>{r.email}</td>
                <td>{r.phone || 'None'}</td>
                <td>{dateShort(r.createdAt)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {canDecide ? (
                    <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(r.id)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(r.id)}
                  >
                    Reject
                  </button>
                    </>
                  ) : (
                    <span className="muted">Waiting for an admin</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        )}
      </div>
      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={requests.length}
        onPage={setPage}
      />
    </div>
  );
}
