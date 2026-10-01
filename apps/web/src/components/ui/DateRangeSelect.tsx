import type { PortalRangePreset } from '@/lib/dateRange';
import { SelectMenu } from '@/components/ui/SelectMenu';

const OPTIONS: Array<{ id: PortalRangePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'thisYear', label: 'This year' },
  { id: 'lastYear', label: 'Last year' },
  { id: 'allTime', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

export function DateRangeSelect({
  preset,
  onPreset,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
}: {
  preset: PortalRangePreset;
  onPreset: (preset: PortalRangePreset) => void;
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
          onChange={(value) => onPreset(value as PortalRangePreset)}
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
