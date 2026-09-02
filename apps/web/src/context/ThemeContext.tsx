import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_THEME_COLORS,
  applyTheme,
  getTheme,
  readStoredTheme,
  saveTheme,
  storeTheme,
  type ThemeColors,
} from '@/lib/theme';

type ThemeState = {
  colors: ThemeColors;
  loaded: boolean;
  preview: (next: ThemeColors) => void;
  persist: (next: ThemeColors) => Promise<ThemeColors>;
};

const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colors, setColors] = useState<ThemeColors>(
    () => readStoredTheme() ?? DEFAULT_THEME_COLORS,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getTheme()
      .then((next) => {
        if (cancelled) return;
        setColors(next);
        storeTheme(next);
        applyTheme(next);
      })
      .catch(() => {
        /* keep defaults / stored theme */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      colors,
      loaded,
      preview: (next) => {
        applyTheme(next);
      },
      persist: async (next) => {
        const saved = await saveTheme(next);
        setColors(saved);
        storeTheme(saved);
        applyTheme(saved);
        return saved;
      },
    }),
    [colors, loaded],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
