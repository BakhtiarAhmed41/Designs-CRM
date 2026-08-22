export function Skeleton({
  width,
  height = 12,
  radius,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}) {
  return (
    <span
      className="skel"
      style={{
        width: width ?? '100%',
        height,
        borderRadius: radius ?? 6,
      }}
      aria-hidden
    />
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skel-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row">
          <span className="skel skel-avatar" />
          <div className="skel-row-body">
            <Skeleton width="42%" height={13} />
            <Skeleton width="68%" height={11} />
          </div>
          <Skeleton width={72} height={22} radius={20} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="skel-stats" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat">
          <Skeleton width="40%" height={10} />
          <div style={{ marginTop: 10 }}>
            <Skeleton width="56%" height={22} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="70%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}
