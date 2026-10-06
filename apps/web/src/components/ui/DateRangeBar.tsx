import type { RangePreset } from '@/lib/dateRange';
import { SelectMenu } from '@/components/ui/SelectMenu';

const OPTIONS: Array<{ id: RangePreset; label: string }> = [
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
      <label className="date-range-select">
        <span>Date range</span>
        <SelectMenu
          size="compact"
          ariaLabel="Date range"
          value={preset}
          onChange={(value) => onPreset(value as RangePreset)}
          options={OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        />
      </label>
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
