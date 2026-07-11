import type { CookieOptions } from 'express';
import { getEnv } from '../config/env';

export function getCookieBaseOptions(): CookieOptions {
  const env = getEnv();
  // Cross-site (Vercel frontend + Render API) needs SameSite=None + Secure.
  // Localhost same-origin can keep Lax.
  return {
    httpOnly: true,
    sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
    secure: env.COOKIE_SECURE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
  };
}

