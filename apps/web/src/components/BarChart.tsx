type Point = Record<string, unknown>;

type BarChartProps = {
  data: Point[];
  valueKey: string;
  labelKey?: string;
  height?: number;
  barColor?: string;
  formatValue?: (n: number) => string;
};

/**
 * Minimal inline-SVG bar chart — no chart library.
 */
export function BarChart({
  data,
  valueKey,
  labelKey = 'date',
  height = 140,
  barColor = 'var(--navy)',
  formatValue,
}: BarChartProps) {
  const values = data.map((d) => Number(d[valueKey] ?? 0));
  const max = Math.max(1, ...values);
  const width = Math.max(280, data.length * 28);
  const pad = 8;
  const barW = Math.max(8, (width - pad * 2) / Math.max(1, data.length) - 4);

  return (
    <svg
      viewBox={`0 0 ${width} ${height + 24}`}
      width="100%"
      height={height + 24}
      role="img"
      aria-label="Chart"
    >
      {data.map((d, i) => {
        const v = Number(d[valueKey] ?? 0);
        const h = (v / max) * height;
        const x = pad + i * (barW + 4);
        const y = height - h;
        const label = String(d[labelKey] ?? '').slice(5); // MM-DD
        return (
          <g key={i}>
            <title>
              {String(d[labelKey] ?? '')}:{' '}
              {formatValue ? formatValue(v) : String(v)}
            </title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(1, h)}
              rx={3}
              fill={barColor}
              opacity={0.85}
            />
            {i % 2 === 0 && (
              <text
                x={x + barW / 2}
                y={height + 14}
                textAnchor="middle"
                fontSize={9}
                fill="var(--faint)"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
