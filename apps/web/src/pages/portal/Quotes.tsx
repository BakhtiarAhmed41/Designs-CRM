import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { listMyOrderSummary, listMyOrders, listQuoteDrafts } from '@/lib/orders';
import { money, dateShort, quoteLifecycleChip } from '@/lib/format';
import { serviceThumbClass, serviceTi } from '@/lib/serviceIcon';
import { isAdminRecounter, studioQuotation } from '@/lib/quoteHelpers';
import { ListToolbar, PaginationBar } from '@/components/lists/ListToolbar';
import { EmptyState, ErrorBanner } from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { freshOnOpen } from '@/lib/queryRefresh';
import { PageHeader } from '@/components/ui/PageHeader';

const DRAFT_LABELS: Record<string, string> = {
  embroidery: 'Embroidery digitizing',
  svg: 'SVG & cut files',
  vector: 'Vector & print files',
  laser: 'CNC & laser cut files',
};

const DRAFT_ICONS: Record<string, string> = {
  embroidery: 'ti-needle-thread',
  svg: 'ti-vector-triangle',
  vector: 'ti-vector-bezier',
  laser: 'ti-router',
};

export function PortalQuotes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const incoming = (location.state as { claimError?: string } | null)?.claimError;
    if (!incoming) return;
    setError(incoming);
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['my-quotes', q, status, dateFrom, dateTo, page],
    queryFn: () =>
      listMyOrders({
        quoteHistory: true,
        quoteStatus: status || undefined,
        q: q.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: 10,
      }),
    ...freshOnOpen,
  });
  const draftsQ = useQuery({
    queryKey: ['my-quote-drafts'],
    queryFn: listQuoteDrafts,
    ...freshOnOpen,
  });
  const summaryQ = useQuery({
    queryKey: ['my-orders-summary'],
    queryFn: listMyOrderSummary,
    ...freshOnOpen,
  });

  const quotes = data?.orders ?? [];
  const drafts = draftsQ.data?.drafts ?? [];
  const totalPages = data?.totalPages ?? 1;
  const awaiting = summaryQ.data?.awaitingQuote ?? 0;
  const pricing = summaryQ.data?.beingPriced ?? 0;

  function continueDraft(serviceKey: string) {
    setDraftsOpen(false);
    navigate(`/portal/quotes/new?service=${encodeURIComponent(serviceKey)}`);
  }

  return (
    <div>
      <PageHeader
        title="Quotes"
        subtitle="Review your quotes and approve when you’re ready to proceed."
        actions={
          <>
            {drafts.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setDraftsOpen(true)}>
                <i className="ti ti-device-floppy" /> Open drafts
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => navigate('/portal/quotes/new')}>
              <i className="ti ti-plus" /> Request a quote
            </button>
          </>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="metric-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Awaiting your approval</div>
          <div className={`mv${awaiting ? ' alert' : ''}`}>{awaiting}</div>
          <div className="md">Your quote is ready to review.</div>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <div className="ml">Quotes in progress</div>
          <div className="mv">{pricing}</div>
          <div className="md">We’re preparing your price.</div>
        </div>
      </div>

      <ListToolbar
        search={q}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search quotes…"
        status={status}
        onStatus={(v) => {
          setStatus(v);
          setPage(1);
        }}
        statusOptions={[
          { value: '', label: 'All statuses' },
          { value: 'draft', label: 'Draft' },
          { value: 'submitted', label: 'Submitted' },
          { value: 'info_needed', label: 'Info Needed' },
          { value: 'in_progress', label: 'Quote in Progress' },
          { value: 'ready', label: 'Ready for Approval' },
          { value: 'approved', label: 'Approved' },
          { value: 'declined', label: 'Declined' },
          { value: 'expired', label: 'Expired' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFrom={(v) => {
          setDateFrom(v);
          setPage(1);
        }}
        onDateTo={(v) => {
          setDateTo(v);
          setPage(1);
        }}
      />

      <div className="card">
        <div className="card-h">
          <span className="ct">Your quotes</span>
        </div>
        {(isLoading || (isFetching && quotes.length === 0)) && <SkeletonRows rows={4} />}
        {!isLoading && !isFetching && quotes.length === 0 && (
          <EmptyState
            icon="ti-file-invoice"
            title="No quotes yet"
            description="Request a quote and we’ll price it. Approve to start production."
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/portal/quotes/new')}>
                Request a quote
              </button>
            }
          />
        )}
        {quotes.map((o) => {
          const chip = quoteLifecycleChip(o.status, 'customer', {
            partiallyAccepted: o.partiallyAccepted,
            adminRecounter: isAdminRecounter(o.quotations),
            needsCustomerInfo: o.needsCustomerInfo,
            createdAt: o.createdAt,
            type: o.type,
          });
          const quote = studioQuotation(o.quotations);
          const lines = quote?.lines ?? [];
          const declined =
            o.status === 'REJECTED' ||
            o.status === 'CLIENT_REJECTED_QUOTATION' ||
            o.status === 'CANCELLED';
          const total = quote?.amountCents ?? null;

          return (
            <div key={o.id}>
              <div
                className="orow quote-orow"
                onClick={() =>
                  navigate(o.type === 'ORDER' ? `/portal/orders/${o.id}` : `/portal/quotes/${o.id}`)
                }
                style={{ cursor: 'pointer' }}
              >
                <div className={`thumb${serviceThumbClass(o.serviceType) ? ' m' : ''}`}>
                  <i className={`ti ${serviceTi(o.serviceType)}`} />
                </div>
                <div className="oinfo">
                  <div className="on">{o.name ?? o.serviceType ?? 'Quote request'}</div>
                  <div className="om">
                    <span>
                      <i className="ti ti-hash" style={{ fontSize: 12 }} />
                      {o.humanRef ?? o.id.slice(0, 6)}
                    </span>
                    {lines.length > 0 && (
                      <span>
                        <i className="ti ti-files" style={{ fontSize: 12 }} />
                        {lines.length} design{lines.length === 1 ? '' : 's'}
                      </span>
                    )}
                    <span>Submitted {dateShort(o.createdAt)}</span>
                  </div>
                </div>
                <span className={chip.cls}>{chip.label}</span>
                <div className="oprice">
                  {total != null ? (
                    <>
                      {money(total, quote?.currency)}
                      <div className="os">Open quote</div>
                    </>
                  ) : declined ? (
                    <span style={{ color: 'var(--faint)', fontWeight: 500 }}>-</span>
                  ) : (
                    <span style={{ color: 'var(--faint)', fontWeight: 500 }}>Pending</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={data?.total ?? quotes.length}
        onPage={setPage}
      />

      {draftsOpen && (
        <div className="overlay open" onClick={() => setDraftsOpen(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <span>Saved drafts</span>
              <button
                type="button"
                className="modal-x"
                onClick={() => setDraftsOpen(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="modal-b" style={{ padding: 0 }}>
              {drafts.length === 0 ? (
                <p className="muted" style={{ margin: 0, padding: 18 }}>
                  No saved drafts.
                </p>
              ) : (
                drafts.map((d, i) => (
                  <div
                    key={d.serviceKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 18px',
                      borderBottom: i === drafts.length - 1 ? 'none' : '1px solid var(--line)',
                    }}
                  >
                    <div className={`thumb${d.serviceKey === 'embroidery' ? ' m' : ''}`}>
                      <i className={`ti ${DRAFT_ICONS[d.serviceKey] ?? 'ti-file'}`} />
                    </div>
                    <div className="oinfo" style={{ flex: 1, minWidth: 0 }}>
                      <div className="on">{DRAFT_LABELS[d.serviceKey] ?? d.serviceKey}</div>
                      <div className="om">Saved {dateShort(d.updatedAt)}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => continueDraft(d.serviceKey)}
                    >
                      Continue
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
