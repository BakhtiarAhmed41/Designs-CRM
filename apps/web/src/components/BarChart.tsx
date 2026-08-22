type Point = Record<string, unknown>;

type BarChartProps = {
  data: Point[];
  valueKey: string;
  valueKey2?: string;
  labelKey?: string;
  height?: number;
  barColor?: string;
  barColor2?: string;
  formatValue?: (n: number) => string;
  formatValue2?: (n: number) => string;
};

/**
 * Minimal inline-SVG bar chart. No chart library.
 */
export function BarChart({
  data,
  valueKey,
  valueKey2,
  labelKey = 'date',
  height = 140,
  barColor = 'var(--navy)',
  barColor2 = 'var(--maroon)',
  formatValue,
  formatValue2,
}: BarChartProps) {
  const values = data.map((d) => Number(d[valueKey] ?? 0));
  const values2 = valueKey2 ? data.map((d) => Number(d[valueKey2] ?? 0)) : [];
  const max = Math.max(1, ...values, ...values2);
  const width = Math.max(280, data.length * 28);
  const pad = 8;
  const slot = (width - pad * 2) / Math.max(1, data.length);
  const barW = Math.max(6, (valueKey2 ? slot / 2 : slot) - 4);

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
        const x = pad + i * slot;
        const y = height - h;
        const label = String(d[labelKey] ?? '').slice(5); // MM-DD
        const v2 = valueKey2 ? Number(d[valueKey2] ?? 0) : 0;
        const h2 = valueKey2 ? (v2 / max) * height : 0;
        return (
          <g key={i}>
            <title>
              {String(d[labelKey] ?? '')}:{' '}
              {formatValue ? formatValue(v) : String(v)}
              {valueKey2
                ? ` · ${formatValue2 ? formatValue2(v2) : String(v2)}`
                : ''}
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
            {valueKey2 && (
              <rect
                x={x + barW + 2}
                y={height - h2}
                width={barW}
                height={Math.max(1, h2)}
                rx={3}
                fill={barColor2}
                opacity={0.85}
              />
            )}
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
