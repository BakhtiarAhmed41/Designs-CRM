import type { CookieOptions } from 'express';
import { getEnv } from '../config/env';

export function getCookieBaseOptions(): CookieOptions {
  const env = getEnv();
  // Website (Vercel/Hostinger) and API (Belmo) are different sites.
  // Those requests need SameSite=None + Secure, or the browser drops the cookie.
  const crossSite = env.COOKIE_SECURE || env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
  };
}

