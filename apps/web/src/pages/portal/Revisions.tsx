import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyAllEdits } from '@/lib/edits';
import { dateShort } from '@/lib/format';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { freshOnOpen } from '@/lib/queryRefresh';

export function PortalRevisions() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-edits'],
    queryFn: listMyAllEdits,
    ...freshOnOpen,
  });
  const edits = data?.edits ?? [];

  return (
    <div>
      <PageHeader
        title="Revisions"
        subtitle="Track changes you have requested on your orders."
      />
      <div className="card">
        {isLoading && <SkeletonRows rows={4} />}
        {!isLoading && edits.length === 0 && (
          <EmptyState
            icon="ti-refresh"
            title="No revisions yet"
            description="When you ask for a change on an order, it will show up here."
          />
        )}
        {edits.map((e) => (
          <Link key={e.id} to={`/portal/orders/${e.orderId}`} className="orow">
            <div className="othumb">
              <i className="ti ti-refresh" />
            </div>
            <div className="oinfo">
              <div className="on">{e.orderName ?? 'Order revision'}</div>
              <div className="om">
                <span>{e.orderRef ?? e.orderId.slice(0, 6)}</span>
                <span>Requested {dateShort(e.createdAt)}</span>
              </div>
            </div>
            <span className={e.status === 'DONE' ? 'chip c-done' : 'portal-chip c-revision'}>
              {e.status === 'DONE' ? 'Done' : 'In progress'}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
