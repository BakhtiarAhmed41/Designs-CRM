import { apiFetch } from './api';

export const THEME_STORAGE_KEY = 'lvd-theme-colors';

export const THEME_COLOR_KEYS = [
  'pageBg',
  'mainText',
  'secondaryText',
  'buttonBg',
  'buttonText',
  'accent',
  'sidebarBg',
  'sidebarText',
  'sidebarActiveBg',
  'sidebarActiveText',
  'topbarBg',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemeColors = Record<ThemeColorKey, string>;

export const DEFAULT_THEME_COLORS: ThemeColors = {
  pageBg: '#FFFFFF',
  mainText: '#222222',
  secondaryText: '#4A4A4A',
  buttonBg: '#222222',
  buttonText: '#FFFFFF',
  accent: '#9A1E22',
  sidebarBg: '#FFFFFF',
  sidebarText: '#222222',
  sidebarActiveBg: '#FFFFFF',
  sidebarActiveText: '#222222',
  topbarBg: '#FFFFFF',
};

export const THEME_FIELDS: Array<{
  key: ThemeColorKey;
  label: string;
  hint: string;
  group: 'app' | 'sidebar';
}> = [
  { key: 'pageBg', label: 'Page background', hint: 'Screen, cards, and popups', group: 'app' },
  { key: 'mainText', label: 'Main text', hint: 'Titles and body text', group: 'app' },
  { key: 'secondaryText', label: 'Secondary text', hint: 'Labels and hints', group: 'app' },
  { key: 'buttonBg', label: 'Button color', hint: 'Main buttons', group: 'app' },
  { key: 'buttonText', label: 'Button text', hint: 'Words on main buttons', group: 'app' },
  { key: 'accent', label: 'Accent color', hint: 'Errors, delete, and alerts', group: 'app' },
  { key: 'sidebarBg', label: 'Sidebar background', hint: 'Left menu background', group: 'sidebar' },
  { key: 'sidebarText', label: 'Menu text', hint: 'Sidebar links', group: 'sidebar' },
  { key: 'sidebarActiveBg', label: 'Active menu background', hint: 'The page you are on', group: 'sidebar' },
  { key: 'sidebarActiveText', label: 'Active menu text', hint: 'Selected page text', group: 'sidebar' },
  { key: 'topbarBg', label: 'Top bar background', hint: 'Bar across the top', group: 'sidebar' },
];

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export function normalizeHex(value: string): string | null {
  const raw = value.trim();
  if (!HEX.test(raw)) return null;
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toUpperCase();
  }
  return raw.toUpperCase();
}

export function normalizeTheme(input: Partial<ThemeColors> | null | undefined): ThemeColors {
  const next = { ...DEFAULT_THEME_COLORS };
  if (!input) return next;
  for (const key of THEME_COLOR_KEYS) {
    const value = input[key];
    if (typeof value !== 'string') continue;
    const hex = normalizeHex(value);
    if (hex) next[key] = hex;
  }
  return next;
}

export function themesEqual(a: ThemeColors, b: ThemeColors): boolean {
  return THEME_COLOR_KEYS.every((key) => a[key] === b[key]);
}

function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = (normalizeHex(hex) ?? '#000000').slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount);
}

function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyTheme(colors: ThemeColors) {
  if (typeof document === 'undefined') return;
  const c = normalizeTheme(colors);
  const tint = c.pageBg;
  const tintHover = mix(c.pageBg, c.mainText, 0.08);
  const faint = mix(c.secondaryText, c.pageBg, 0.22);
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': c.pageBg,
    '--card': c.pageBg,
    '--etsy-white': c.pageBg,
    '--ink': c.mainText,
    '--navy': c.buttonBg,
    '--navy-d': darken(c.buttonBg, 0.45),
    '--muted': c.secondaryText,
    '--faint': faint,
    '--maroon': c.accent,
    '--maroon-d': darken(c.accent, 0.18),
    '--line': rgba(c.mainText, 0.1),
    '--line-s': rgba(c.mainText, 0.06),
    '--tint': tint,
    '--tint-m': tint,
    '--tint-hover': tintHover,
    '--green': c.buttonBg,
    '--green-bg': c.pageBg,
    '--amber': c.mainText,
    '--amber-bg': c.pageBg,
    '--purple': c.mainText,
    '--purple-bg': c.pageBg,
    '--focus': `0 0 0 3px ${rgba(c.buttonBg, 0.16)}`,
    '--dash-white': c.pageBg,
    '--dash-ink': c.mainText,
    '--dash-muted': c.secondaryText,
    '--dash-faint': faint,
    '--button-bg': c.buttonBg,
    '--button-text': c.buttonText,
    '--button-bg-hover': darken(c.buttonBg, 0.45),
    '--sidebar-bg': c.sidebarBg,
    '--sidebar-text': c.sidebarText,
    '--sidebar-active-bg': c.sidebarActiveBg,
    '--sidebar-active-text': c.sidebarActiveText,
    '--topbar-bg': c.topbarBg,
  };
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export function readStoredTheme(): ThemeColors | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    return normalizeTheme(JSON.parse(raw) as Partial<ThemeColors>);
  } catch {
    return null;
  }
}

export function storeTheme(colors: ThemeColors) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalizeTheme(colors)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getTheme() {
  return apiFetch<{ colors: ThemeColors }>('/theme').then((res) => normalizeTheme(res.colors));
}

export function saveTheme(colors: ThemeColors) {
  return apiFetch<{ colors: ThemeColors }>('/admin/theme', {
    method: 'PUT',
    body: JSON.stringify(normalizeTheme(colors)),
  }).then((res) => normalizeTheme(res.colors));
}

const stored = readStoredTheme();
if (stored) applyTheme(stored);
