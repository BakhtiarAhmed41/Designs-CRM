import { sameFileName } from '@/lib/format';
import type { QuotationLine } from '@/lib/designs';

export type EmbSize = {
  label?: string;
  detail?: string;
  placement?: string;
  keepProportional?: boolean;
  w?: string;
  h?: string;
  unit?: string;
};

export type EmbDesign = {
  name?: string;
  service?: string;
  notes?: string;
  sizes?: EmbSize[];
  artworkFileNames?: string[];
  referenceFileNames?: string[];
  fileNames?: string[];
  background?: string;
  colors?: string;
  dpi300?: boolean;
};

export type EmbPrefs = {
  service?: string;
  unit?: string | null;
  turnaround?: string | null;
  formats?: string[];
  designs?: EmbDesign[];
};

export type EmbAttachment = {
  id: string;
  name: string;
  mimeType?: string | null;
  previewUrl?: string | null;
};

const DESIGN_NOTE = 'design:';

export function isEmbroideryRequest(order: {
  serviceType?: string | null;
  preferences?: unknown;
}) {
  if (order.serviceType === 'EMBROIDERY') return true;
  return asEmbroideryPrefs(order.preferences)?.service === 'embroidery';
}

export function isCuttingRequest(order: {
  serviceType?: string | null;
  preferences?: unknown;
}) {
  if (order.serviceType === 'CNC_LASER') return true;
  const service = asEmbroideryPrefs(order.preferences)?.service;
  return service === 'laser' || service === 'svg';
}

export function cuttingServiceLabel(designs: EmbDesign[]) {
  const names = [...new Set(designs.map((design) => design.service?.trim()).filter(Boolean))];
  return names.length ? names.join(', ') : 'Cutting & Engraving';
}

export function isVectorRequest(order: {
  serviceType?: string | null;
  preferences?: unknown;
}) {
  if (order.serviceType === 'VECTOR') return true;
  return asEmbroideryPrefs(order.preferences)?.service === 'vector';
}

export function vectorServiceLabel(designs: EmbDesign[]) {
  const names = [...new Set(designs.map((design) => design.service?.trim()).filter(Boolean))];
  return names.length ? names.join(', ') : 'Vector & Print';
}

export type ServiceKind = 'embroidery' | 'cutting' | 'vector';

/** Live embroidery, cutting, and vector orders use the prototype order screens. */
export function serviceOrderKind(order: {
  type?: string | null;
  serviceType?: string | null;
  preferences?: unknown;
}): ServiceKind | null {
  if (order.type !== 'ORDER') return null;
  if (isCuttingRequest(order)) return 'cutting';
  if (isVectorRequest(order)) return 'vector';
  if (isEmbroideryRequest(order)) return 'embroidery';
  return null;
}

export function serviceRequestedLabel(kind: ServiceKind, designs: EmbDesign[]) {
  if (kind === 'cutting') return cuttingServiceLabel(designs);
  if (kind === 'vector') return vectorServiceLabel(designs);
  return 'Embroidery Digitizing';
}

function titlePreference(value?: string | null, fallback = '—') {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (/^keep original$/i.test(raw)) return 'Keep Original';
  if (/^recommend/i.test(raw)) return 'Recommend for Me';
  if (/^transparent$/i.test(raw)) return 'Transparent';
  if (/^not sure$/i.test(raw)) return 'Not sure';
  return raw;
}

export function backgroundLabel(value?: string | null) {
  return titlePreference(value, 'Transparent');
}

export function colorModeLabel(value?: string | null) {
  return titlePreference(value, 'RGB');
}

export function colorSelectedLabel(designs: EmbDesign[]) {
  const names = [...new Set(designs.map((design) => colorModeLabel(design.colors)).filter((name) => name !== '—'))];
  return names.length ? names.join(', ') : 'RGB';
}

export function resolutionLabel(dpi300?: boolean) {
  return dpi300 === false ? 'Not requested' : '300 DPI';
}

export function asEmbroideryPrefs(preferences: unknown): EmbPrefs | null {
  if (!preferences || typeof preferences !== 'object') return null;
  return preferences as EmbPrefs;
}

export function unitLabel(unit?: string | null) {
  if (unit === 'cm') return 'Centimeters';
  if (unit === 'mm') return 'Millimeters';
  return 'Inches';
}

export function turnaroundLabel(key?: string | null) {
  if (key === 'urgent') return 'Urgent · 4–8 Hours';
  return 'Standard · 12–36 Hours';
}

export function designOptionLabel(index: number, name?: string | null) {
  const title = name?.trim() || `Design ${index + 1}`;
  return `Design ${index + 1} - ${title}`;
}

export function customerDesignTitle(stored: string) {
  return stored.replace(' - ', ' · ');
}

export function designNote(label: string) {
  return `${DESIGN_NOTE}${label}`;
}

export function parseDesignNote(note?: string | null) {
  if (!note?.startsWith(DESIGN_NOTE)) return null;
  const value = note.slice(DESIGN_NOTE.length).trim();
  return value || null;
}

export function embroideryDesigns(
  preferences: unknown,
  fallbackName?: string | null,
): EmbDesign[] {
  const prefs = asEmbroideryPrefs(preferences);
  const designs = (prefs?.designs ?? []).filter((d) => d && typeof d === 'object');
  if (designs.length > 0) return designs;
  return [
    {
      name: fallbackName?.trim() || 'Design',
      notes: '',
      sizes: [],
      artworkFileNames: [],
      referenceFileNames: [],
    },
  ];
}

export function designCountLabel(count: number) {
  return count === 1 ? '1 Design' : `${count} Designs`;
}

function takeNamed(pool: EmbAttachment[], names: string[] | undefined, claimed: Set<string>) {
  const found: EmbAttachment[] = [];
  for (const name of names ?? []) {
    const match = pool.find((file) => !claimed.has(file.id) && sameFileName(file.name, name));
    if (!match) continue;
    claimed.add(match.id);
    found.push(match);
  }
  return found;
}

export function filesForDesign(design: EmbDesign, attachments: EmbAttachment[], claimed: Set<string>) {
  const artwork = takeNamed(attachments, design.artworkFileNames, claimed);
  const references = takeNamed(attachments, design.referenceFileNames, claimed);
  if (artwork.length === 0 && references.length === 0) {
    const leftovers = takeNamed(attachments, design.fileNames, claimed);
    return { artwork: leftovers, references: [] as EmbAttachment[] };
  }
  return { artwork, references };
}

export function sizeDetail(size: EmbSize) {
  if (size.detail?.trim()) return size.detail.trim();
  const wh = [size.w, size.h].filter(Boolean).join(' × ');
  if (wh) return `${wh}${size.unit ? ` ${size.unit}` : ''}`;
  return size.label?.trim() || 'Size';
}

export type PricedGroup = {
  title: string;
  lines: QuotationLine[];
};

export function groupQuoteLines(
  lines: QuotationLine[],
  designLabels: string[],
): PricedGroup[] {
  const groups: PricedGroup[] = [];
  const index = new Map<string, PricedGroup>();
  for (const line of lines) {
    const stored = parseDesignNote(line.note);
    const title = stored ? customerDesignTitle(stored) : designLabels[0] ?? 'Quote';
    let group = index.get(title);
    if (!group) {
      group = { title, lines: [] };
      index.set(title, group);
      groups.push(group);
    }
    group.lines.push(line);
  }
  return groups;
}
