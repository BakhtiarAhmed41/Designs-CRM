import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveLoginRequest,
  deleteLoginRequest,
  listLoginRequests,
} from '@/lib/auth';
import { getErrorMessage } from '@/lib/api';
import { dateShort } from '@/lib/format';
import { useState } from 'react';

export function AdminLoginRequests() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['login-requests'],
    queryFn: listLoginRequests,
    refetchInterval: 20_000,
  });
  const requests = data?.requests ?? [];

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
      <div className="ph">
        <div>
          <h1>New login requests</h1>
          <div className="sub">
            Approve or delete pending customer registrations before they can sign in.
          </div>
        </div>
      </div>
      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="card">
        {isLoading && <div style={{ padding: 16 }}>Loading…</div>}
        {!isLoading && requests.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No pending login requests.</div>
        )}
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
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>{r.email}</td>
                <td>{r.phone || '—'}</td>
                <td>{dateShort(r.createdAt)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
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
                    className="btn btn-ghost btn-sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(r.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
