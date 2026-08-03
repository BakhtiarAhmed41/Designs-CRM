import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptQuotation,
  getMyOrder,
  rejectQuotation,
} from '@/lib/orders';
import { createMyConversation, listMyConversations } from '@/lib/messaging';
import { getErrorMessage } from '@/lib/api';
import { dateShort, money, quoteLifecycleChip } from '@/lib/format';
import type { QuotationLine } from '@/lib/designs';
import type { Order, Quotation } from '@/lib/types';

type QuoteWithLines = Quotation & { lines?: QuotationLine[] };

function lineTotal(l: QuotationLine) {
  return (l.priceCents ?? 0) + l.sizes.reduce((s, sz) => s + (sz.priceCents ?? 0), 0);
}

export function PortalQuoteDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<string[] | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-order', id],
    queryFn: () => getMyOrder(id),
    enabled: !!id,
  });

  const order = data?.order as Order | undefined;
  const quotations = (order as Order & { quotations?: QuoteWithLines[] } | undefined)
    ?.quotations;
  const latest = quotations?.[0];
  const lines = latest?.lines ?? [];

  const selected = useMemo(() => {
    if (kept) return kept;
    return lines.map((l) => l.id);
  }, [kept, lines]);

  const total = lines
    .filter((l) => selected.includes(l.id))
    .reduce((sum, l) => sum + lineTotal(l), 0);

  const acceptMut = useMutation({
    mutationFn: () => acceptQuotation(id, selected),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      void qc.invalidateQueries({ queryKey: ['my-order', id] });
      void qc.invalidateQueries({ queryKey: ['admin-quotes'] });
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      navigate('/portal/orders');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const rejectMut = useMutation({
    mutationFn: () => rejectQuotation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      void qc.invalidateQueries({ queryKey: ['my-order', id] });
      void qc.invalidateQueries({ queryKey: ['admin-quotes'] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const startChat = useMutation({
    mutationFn: async () => {
      const listed = await listMyConversations();
      const existing = listed.conversations.find(
        (c) => c.orderId === id && c.chatType === 'QUOTE',
      );
      if (existing) return existing;
      const created = await createMyConversation({
        orderId: id,
        chatType: 'QUOTE',
        subject: order?.humanRef
          ? `Quotation ${order.humanRef} Chat`
          : 'Quotation Chat',
      });
      return created.conversation;
    },
    onSuccess: (convo) => navigate(`/portal/messages?c=${convo.id}`),
    onError: (e) => setError(getErrorMessage(e)),
  });

  if (isLoading) {
    return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading…</div>;
  }
  if (!order) {
    return <div style={{ padding: 16, color: 'var(--muted)' }}>Quote not found.</div>;
  }

  if (order.type === 'ORDER') {
    return (
      <div style={{ padding: 16 }}>
        <div className="muted" style={{ marginBottom: 10 }}>
          This quote was accepted and converted to an order.
        </div>
        <Link to={`/portal/orders/${order.id}`} className="btn btn-primary">
          Open order
        </Link>
      </div>
    );
  }

  const canDecide = order.status === 'QUOTATION_PROVIDED';
  const statusChip = quoteLifecycleChip(order.status, 'customer', {
    partiallyAccepted: order.partiallyAccepted,
  });

  return (
    <div>
      <div className="ph">
        <div>
          <Link to="/portal/quotes" className="muted" style={{ fontSize: 13 }}>
            ← Back to quotes
          </Link>
          <h1 style={{ marginTop: 6 }}>{order.name ?? 'Quote request'}</h1>
          <div className="sub">
            Q-{order.humanRef ?? order.id.slice(0, 6)} · {dateShort(order.createdAt)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={statusChip.cls}>{statusChip.label}</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={startChat.isPending}
            onClick={() => startChat.mutate()}
          >
            <i className="ti ti-message" /> Message about this quote
          </button>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ padding: 18 }}>
        {lines.length === 0 ? (
          <div className="muted">
            {order.status === 'WAITING_FOR_QUOTATION' || order.status === 'CREATED'
              ? 'Your request is being priced. You’ll see line items here when a quote is ready.'
              : 'No quotation lines yet.'}
          </div>
        ) : (
          <>
            {lines.map((l) => {
              const on = selected.includes(l.id);
              return (
                <label
                  key={l.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    padding: '12px 0',
                    borderBottom: '0.5px solid var(--line)',
                    cursor: canDecide ? 'pointer' : 'default',
                  }}
                >
                  {canDecide && (
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        setKept((prev) => {
                          const cur = prev ?? lines.map((x) => x.id);
                          return on
                            ? cur.filter((x) => x !== l.id)
                            : [...cur, l.id];
                        });
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    {l.note && <div className="muted" style={{ fontSize: 12.5 }}>{l.note}</div>}
                    {l.sizes.length > 0 && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {l.sizes.map((s) => `${s.label}: ${money(s.priceCents)}`).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div style={{ fontWeight: 600 }}>{money(lineTotal(l))}</div>
                </label>
              );
            })}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 16,
              }}
            >
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Selected total</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{money(total)}</div>
              </div>
              {canDecide && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={rejectMut.isPending}
                    onClick={() => rejectMut.mutate()}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={acceptMut.isPending || selected.length === 0}
                    onClick={() => acceptMut.mutate()}
                  >
                    Accept &amp; convert to order
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
