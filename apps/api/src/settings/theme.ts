import { z } from 'zod';

export const THEME_SETTING_KEY = 'theme.colors';

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

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const hexField = z
  .string()
  .regex(HEX, 'Enter a color like #222222');

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

export const themeColorsSchema = z.object({
  pageBg: hexField,
  mainText: hexField,
  secondaryText: hexField,
  buttonBg: hexField,
  buttonText: hexField,
  accent: hexField,
  sidebarBg: hexField,
  sidebarText: hexField,
  sidebarActiveBg: hexField,
  sidebarActiveText: hexField,
  topbarBg: hexField,
});

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
