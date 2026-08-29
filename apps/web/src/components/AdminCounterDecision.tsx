import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { recounterQuotation, rejectCounter } from '@/lib/orders';
import { getErrorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import type { Order } from '@/lib/types';

export function AdminCounterDecision({
  orderId,
  customerAmount,
  customerNote,
  studioAmount,
  canApprove,
  approvePending,
  onApprove,
  onDone,
  onError,
}: {
  orderId: string;
  customerAmount: number | null | undefined;
  customerNote?: string | null;
  studioAmount?: number | null;
  canApprove: boolean;
  approvePending: boolean;
  onApprove: () => void;
  onDone: (order: Order, kind: 'reject' | 'recounter') => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<null | 'recounter' | 'close'>(null);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');

  const rejectMut = useMutation({
    mutationFn: () => rejectCounter(orderId, note.trim()),
    onSuccess: (res) => {
      setMode(null);
      setNote('');
      onDone(res.order, 'reject');
    },
    onError: (e) => onError(getErrorMessage(e)),
  });

  const recounterMut = useMutation({
    mutationFn: () =>
      recounterQuotation(orderId, {
        amountCents: Math.round(parseFloat(amount || '0') * 100),
        comment: note.trim(),
      }),
    onSuccess: (res) => {
      setMode(null);
      setNote('');
      setAmount('');
      onDone(res.order, 'recounter');
    },
    onError: (e) => onError(getErrorMessage(e)),
  });

  const busy = rejectMut.isPending || recounterMut.isPending;

  return (
    <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
      <div className="card-h">
        <span className="ct">
          <i className="ti ti-scale" /> Customer counter offer
        </span>
      </div>
      <div className="card-b">
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
          Customer&apos;s counter
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
          {money(customerAmount)}
        </div>
        {customerNote && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              marginBottom: 14,
              fontStyle: 'italic',
            }}
          >
            “{customerNote}”
          </div>
        )}
        {studioAmount != null && (
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Studio quote was {money(studioAmount)}
          </div>
        )}

        {canApprove ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
              disabled={approvePending || busy}
              onClick={onApprove}
            >
              <i className="ti ti-check" /> {approvePending ? 'Approving…' : 'Approve counter'}
            </button>

            {mode === null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={busy}
                  onClick={() => {
                    setMode('recounter');
                    setNote('');
                    setAmount('');
                  }}
                >
                  <i className="ti ti-scale" /> Reject and re-counter
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={busy}
                  onClick={() => {
                    setMode('close');
                    setNote('');
                  }}
                >
                  <i className="ti ti-x" /> Reject and close quote
                </button>
              </div>
            )}

            {mode === 'recounter' && (
              <div className="quote-counter" style={{ marginTop: 8 }}>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                  Reject their counter and send your own price with a note.
                </div>
                <label className="quote-counter-field" style={{ marginBottom: 10 }}>
                  <span>Your re-counter amount</span>
                  <div className="quote-counter-amount">
                    <span aria-hidden>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </label>
                <label className="quote-counter-field">
                  <span>Note for the customer</span>
                  <textarea
                    rows={2}
                    placeholder="Required — why this price"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setMode(null)}
                    disabled={busy}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy || !note.trim() || !amount}
                    onClick={() => recounterMut.mutate()}
                  >
                    {recounterMut.isPending ? 'Sending…' : 'Send re-counter'}
                  </button>
                </div>
              </div>
            )}

            {mode === 'close' && (
              <div className="quote-counter" style={{ marginTop: 8 }}>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                  Close this quote as declined by the studio. You can still open it later to revise or delete.
                </div>
                <label className="quote-counter-field">
                  <span>Note for the customer</span>
                  <textarea
                    rows={2}
                    placeholder="Required — why this is closed"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setMode(null)}
                    disabled={busy}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy || !note.trim()}
                    onClick={() => rejectMut.mutate()}
                  >
                    {rejectMut.isPending ? 'Closing…' : 'Reject and close'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Waiting for an admin to approve or reject this counter.
          </div>
        )}
      </div>
    </div>
  );
}
