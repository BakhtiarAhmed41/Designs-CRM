import type { CookieOptions } from 'express';
import { getEnv } from '../config/env';

export function getCookieBaseOptions(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
  };
}

