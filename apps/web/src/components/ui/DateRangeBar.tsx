import type { RangePreset } from '@/lib/dateRange';

const PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

export function DateRangeBar({
  preset,
  onPreset,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
}: {
  preset: RangePreset;
  onPreset: (preset: RangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
}) {
  return (
    <div className="dash-range">
      <div className="range" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? 'on' : ''}
            onClick={() => onPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="pulse-dates">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustomFrom(e.target.value)}
            aria-label="From date"
          />
          <span>to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomTo(e.target.value)}
            aria-label="To date"
          />
        </div>
      )}
    </div>
  );
}
