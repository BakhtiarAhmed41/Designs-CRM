export type RangePreset = 'week' | 'month' | 'thisMonth' | 'custom';

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function datesForPreset(preset: RangePreset, customFrom: string, customTo: string) {
  const today = new Date();
  if (preset === 'week') {
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (preset === 'month') {
    const from = new Date(today);
    from.setDate(today.getDate() - 29);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (preset === 'thisMonth') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDate(from), to: isoDate(today) };
  }
  return { from: customFrom, to: customTo };
}

export function inDateRange(iso: string | null | undefined, from: string, to: string) {
  if (!iso || !from || !to) return false;
  const key = iso.slice(0, 10);
  return key >= from && key <= to;
}
