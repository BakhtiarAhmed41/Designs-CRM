import { apiFetch } from './api';

export const THEME_STORAGE_KEY = 'lvd-theme-colors';
export const THEME_IFRAME_TYPE = 'lvd-apply-theme';

export const THEME_COLOR_KEYS = [
  'pageBg',
  'cardBg',
  'mainText',
  'secondaryText',
  'hoverBg',
  'buttonBg',
  'buttonText',
  'accent',
  'sidebarBg',
  'sidebarText',
  'sidebarActiveBg',
  'sidebarActiveText',
  'topbarBg',
  'formBg',
  'formText',
  'formBorder',
  'formFocus',
  'success',
  'warning',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemeColors = Record<ThemeColorKey, string>;

export const DEFAULT_THEME_COLORS: ThemeColors = {
  pageBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  mainText: '#222222',
  secondaryText: '#4A4A4A',
  hoverBg: '#F4F5F7',
  buttonBg: '#222222',
  buttonText: '#FFFFFF',
  accent: '#9A1E22',
  sidebarBg: '#FFFFFF',
  sidebarText: '#222222',
  sidebarActiveBg: '#FFFFFF',
  sidebarActiveText: '#222222',
  topbarBg: '#FFFFFF',
  formBg: '#FFFFFF',
  formText: '#222222',
  formBorder: '#E5E7EB',
  formFocus: '#222222',
  success: '#1F6B4A',
  warning: '#A67C00',
};

export const THEME_FIELDS: Array<{
  key: ThemeColorKey;
  label: string;
  hint: string;
  group: 'app' | 'sidebar' | 'form' | 'status';
}> = [
  { key: 'pageBg', label: 'Page background', hint: 'Screen behind cards', group: 'app' },
  { key: 'cardBg', label: 'Card background', hint: 'Cards and popups', group: 'app' },
  { key: 'mainText', label: 'Main text', hint: 'Titles and body text', group: 'app' },
  { key: 'secondaryText', label: 'Secondary text', hint: 'Labels and hints', group: 'app' },
  { key: 'hoverBg', label: 'Hover background', hint: 'Rows and menus on hover', group: 'app' },
  { key: 'buttonBg', label: 'Button color', hint: 'Main buttons', group: 'app' },
  { key: 'buttonText', label: 'Button text', hint: 'Words on main buttons', group: 'app' },
  { key: 'accent', label: 'Accent color', hint: 'Links, errors, and alerts', group: 'app' },
  { key: 'sidebarBg', label: 'Sidebar background', hint: 'Left menu background', group: 'sidebar' },
  { key: 'sidebarText', label: 'Menu text', hint: 'Sidebar links', group: 'sidebar' },
  { key: 'sidebarActiveBg', label: 'Active menu background', hint: 'The page you are on', group: 'sidebar' },
  { key: 'sidebarActiveText', label: 'Active menu text', hint: 'Selected page text', group: 'sidebar' },
  { key: 'topbarBg', label: 'Top bar background', hint: 'Bar across the top', group: 'sidebar' },
  { key: 'formBg', label: 'Field background', hint: 'Inputs and quote forms', group: 'form' },
  { key: 'formText', label: 'Field text', hint: 'Typed text in boxes', group: 'form' },
  { key: 'formBorder', label: 'Field border', hint: 'Input outlines', group: 'form' },
  { key: 'formFocus', label: 'Field focus', hint: 'Border when a box is selected', group: 'form' },
  { key: 'success', label: 'Success', hint: 'Done and paid labels', group: 'status' },
  { key: 'warning', label: 'Warning', hint: 'Waiting and caution labels', group: 'status' },
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

export function themeCssVars(colors: ThemeColors): Record<string, string> {
  const c = normalizeTheme(colors);
  const faint = mix(c.secondaryText, c.pageBg, 0.22);
  return {
    '--bg': c.pageBg,
    '--card': c.cardBg,
    '--etsy-white': c.cardBg,
    '--ink': c.mainText,
    '--navy': c.buttonBg,
    '--navy-d': darken(c.buttonBg, 0.45),
    '--muted': c.secondaryText,
    '--faint': faint,
    '--maroon': c.accent,
    '--maroon-d': darken(c.accent, 0.18),
    '--brand': c.accent,
    '--brand-d': darken(c.accent, 0.18),
    '--line': rgba(c.mainText, 0.1),
    '--line-s': rgba(c.mainText, 0.06),
    '--tint': mix(c.pageBg, c.mainText, 0.04),
    '--tint-m': mix(c.pageBg, c.accent, 0.12),
    '--tint-hover': c.hoverBg,
    '--green': c.success,
    '--green-bg': mix(c.pageBg, c.success, 0.14),
    '--amber': c.warning,
    '--amber-bg': mix(c.pageBg, c.warning, 0.14),
    '--purple': c.buttonBg,
    '--purple-bg': mix(c.pageBg, c.buttonBg, 0.1),
    '--focus': `0 0 0 3px ${rgba(c.formFocus, 0.16)}`,
    '--dash-white': c.cardBg,
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
    '--form-bg': c.formBg,
    '--form-text': c.formText,
    '--form-border': c.formBorder,
    '--form-focus': c.formFocus,
    '--form-muted': c.secondaryText,
    '--form-label': c.mainText,
    '--hover-bg': c.hoverBg,
  };
}

export function applyTheme(colors: ThemeColors, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement) {
  if (!root) return;
  for (const [key, value] of Object.entries(themeCssVars(colors))) {
    root.style.setProperty(key, value);
  }
}

export function postThemeToWindow(win: Window | null | undefined, colors: ThemeColors) {
  if (!win) return;
  win.postMessage({ type: THEME_IFRAME_TYPE, colors: normalizeTheme(colors) }, '*');
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
else if (typeof document !== 'undefined') applyTheme(DEFAULT_THEME_COLORS);
