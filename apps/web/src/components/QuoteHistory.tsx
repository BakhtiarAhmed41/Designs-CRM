import { dateShort, money } from '@/lib/format';
import { quoteHistoryLabel, type QuoteWithLines } from '@/lib/quoteHelpers';

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: 'Open',
  SENT: 'Sent',
  COUNTERED: 'Countered',
  APPROVED: 'Accepted',
  REJECTED: 'Rejected',
  NEEDS_PRICE: 'Needs price',
};

export function QuoteHistory({
  quotations,
}: {
  quotations?: QuoteWithLines[] | null;
}) {
  const list = [...(quotations ?? [])].sort((a, b) => a.version - b.version);
  if (list.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-h">
        <span className="ct">
          <i className="ti ti-history" /> Quote history
        </span>
      </div>
      {list.map((q) => (
        <div
          key={q.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
            padding: '12px 16px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>
              v{q.version} · {quoteHistoryLabel(q, list)}
            </div>
            {q.comment && (
              <div
                className="muted"
                style={{ fontSize: 12.5, marginTop: 4, fontStyle: 'italic' }}
              >
                “{q.comment}”
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {dateShort(q.createdAt)} · {STATUS_LABEL[q.status] ?? q.status}
            </div>
          </div>
          <div style={{ fontWeight: 700, color: 'var(--navy)', flexShrink: 0 }}>
            {money(q.amountCents, q.currency)}
          </div>
        </div>
      ))}
    </div>
  );
}
