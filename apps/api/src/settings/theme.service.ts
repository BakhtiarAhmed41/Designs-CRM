import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import {
  DEFAULT_THEME_COLORS,
  THEME_SETTING_KEY,
  normalizeTheme,
  themeColorsSchema,
  type ThemeColors,
} from './theme';

@Injectable()
export class ThemeService {
  constructor(private db: DbService) {}

  async get(): Promise<ThemeColors> {
    try {
      const row = await this.db.queryOne<{ setting_value: string }>(
        'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
        [THEME_SETTING_KEY],
      );
      return normalizeTheme(parseStored(row?.setting_value));
    } catch {
      return { ...DEFAULT_THEME_COLORS };
    }
  }

  async save(input: ThemeColors): Promise<ThemeColors> {
    const colors = normalizeTheme(themeColorsSchema.parse(input));
    const json = JSON.stringify(colors);
    await this.db.execute(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [THEME_SETTING_KEY, json],
    );
    return colors;
  }
}

function parseStored(raw: string | undefined): Partial<ThemeColors> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Partial<ThemeColors>;
  } catch {
    return null;
  }
}
