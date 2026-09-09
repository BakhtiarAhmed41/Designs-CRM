export type RangePreset = 'week' | 'month' | 'thisMonth' | 'custom';

export type PortalRangePreset =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'thisMonth'
  | 'thisYear'
  | 'lastYear'
  | 'allTime'
  | 'custom';

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

export function datesForPortalPreset(
  preset: PortalRangePreset,
  customFrom: string,
  customTo: string,
) {
  const today = new Date();
  if (preset === 'today') {
    const key = isoDate(today);
    return { from: key, to: key };
  }
  if (preset === 'yesterday') {
    const d = new Date(today);
    d.setDate(today.getDate() - 1);
    const key = isoDate(d);
    return { from: key, to: key };
  }
  if (preset === 'thisYear') {
    return { from: `${today.getFullYear()}-01-01`, to: isoDate(today) };
  }
  if (preset === 'lastYear') {
    const y = today.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (preset === 'allTime') {
    return { from: '', to: '' };
  }
  if (preset === 'week' || preset === 'month' || preset === 'thisMonth' || preset === 'custom') {
    return datesForPreset(preset, customFrom, customTo);
  }
  return { from: customFrom, to: customTo };
}

export function inDateRange(iso: string | null | undefined, from: string, to: string) {
  if (!iso || !from || !to) return false;
  const key = iso.slice(0, 10);
  return key >= from && key <= to;
}
