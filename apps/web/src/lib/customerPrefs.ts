export type CustomerFilePrefs = {
  services: string[];
  hoops: string[];
  embFormats: string[];
  digFormats: string[];
  cncFormats: string[];
  placement?: string;
  embOther?: string;
  digOther?: string;
  cncOther?: string;
};

const SERVICE_TO_QUOTE: Record<string, string> = {
  emb: 'embroidery',
  dig: 'vector',
  cnc: 'laser',
};

export const HOOP_OPTIONS = ['4x4', '5x7', '6x10', '7x12', '8x8', '8x12', 'Cap frame 2.5x6'];

export function normalizeHoopSize(value: string) {
  return value.trim().replace(/\s+/g, ' ').replace(/(\d)\s*[x×]\s*(?=\d)/gi, '$1x').slice(0, 40);
}

export function cleanHoopSizes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((item): item is string => typeof item === 'string').map(normalizeHoopSize).filter((item) => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

export function hasUsefulFilePrefs(raw: unknown) {
  const p = asCustomerFilePrefs(raw);
  if (!p) return false;
  return Boolean(
    p.placement ||
      p.hoops.length ||
      p.embFormats.length ||
      p.digFormats.length ||
      p.cncFormats.length,
  );
}

export function asCustomerFilePrefs(raw: unknown): CustomerFilePrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<CustomerFilePrefs>;
  return {
    services: asStringList(p.services),
    hoops: asStringList(p.hoops),
    embFormats: asStringList(p.embFormats),
    digFormats: asStringList(p.digFormats),
    cncFormats: asStringList(p.cncFormats),
    placement: typeof p.placement === 'string' ? p.placement.trim() : '',
    embOther: typeof p.embOther === 'string' ? p.embOther.trim() : '',
    digOther: typeof p.digOther === 'string' ? p.digOther.trim() : '',
    cncOther: typeof p.cncOther === 'string' ? p.cncOther.trim() : '',
  };
}

export function quoteKeyFromServiceType(serviceType?: string | null) {
  const t = (serviceType || '').toUpperCase();
  if (t.includes('EMBROID')) return 'embroidery';
  if (t.includes('CNC') || t.includes('LASER')) return 'laser';
  if (t.includes('VECTOR') || t.includes('PRINT')) return 'vector';
  return '';
}

export function isUsualQuoteService(prefs: unknown, quoteKey: string) {
  const p = asCustomerFilePrefs(prefs);
  if (!p) return false;
  return p.services.some((id) => SERVICE_TO_QUOTE[id] === quoteKey);
}

function cleanFormats(list: string[], extra = '') {
  const extras = extra
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...list, ...extras]) {
    const key = item.toLowerCase();
    if (!item || key === 'others' || key === 'other' || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function formatsForQuoteService(prefs: unknown, quoteKey: string) {
  const p = asCustomerFilePrefs(prefs);
  if (!p || !isUsualQuoteService(p, quoteKey)) return [];
  if (quoteKey === 'embroidery') return cleanFormats(p.embFormats, p.embOther);
  if (quoteKey === 'laser') return cleanFormats(p.cncFormats, p.cncOther);
  return cleanFormats(p.digFormats, p.digOther);
}

export function quoteFormatsFromPrefs(
  collected: string[] | undefined,
  prefs: unknown,
  quoteKey: string,
) {
  const fromForm = (collected ?? []).map((s) => s.trim()).filter(Boolean);
  if (fromForm.length) return fromForm;
  return formatsForQuoteService(prefs, quoteKey);
}

export function orderRequestedFormats(orderPrefs: unknown, designs?: Array<{ requestedFormats?: string[] | null }>) {
  const fromDesigns = (designs ?? []).flatMap((d) => d.requestedFormats ?? []).filter(Boolean);
  if (fromDesigns.length) return [...new Set(fromDesigns)];
  const p = orderPrefs && typeof orderPrefs === 'object' ? (orderPrefs as { formats?: unknown }) : null;
  return cleanFormats(asStringList(p?.formats));
}

export function customerSetupLines(prefs: unknown) {
  const p = asCustomerFilePrefs(prefs);
  if (!p || !isUsualQuoteService(p, 'embroidery')) return [];
  const rows: Array<{ label: string; value: string }> = [];
  if (p.placement) rows.push({ label: 'Usual placement', value: p.placement });
  if (p.hoops.length) rows.push({ label: 'Usual hoop sizes', value: p.hoops.join(', ') });
  return rows;
}
