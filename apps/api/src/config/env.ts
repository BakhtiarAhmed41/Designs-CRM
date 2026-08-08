import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .optional()
    .default('development'),

  PORT: z.coerce.number().int().positive().optional().default(3001),

  // MySQL (local phpMyAdmin in dev, Hostinger MySQL in prod). No ORM.
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).default('root'),
  DB_PASSWORD: z.string().optional().default(''),
  DB_NAME: z.string().min(1).default('designs_crm'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),

  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  COOKIE_SECURE: booleanString.optional().default(false),
  COOKIE_DOMAIN: z.string().optional().default(''),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),

  // When true and SMTP did not send, forgot-password may return resetToken (local only).
  AUTH_EXPOSE_RESET_TOKEN: booleanString.optional().default(false),

  // Local disk file storage.
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  // Optional; empty string is allowed and falls back to JWT_ACCESS_SECRET.
  STORAGE_URL_SECRET: z
    .string()
    .min(16)
    .optional()
    .or(z.literal('')),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      'Invalid environment variables',
      parsed.error.flatten().fieldErrors,
    );
    throw new Error('Invalid environment variables');
  }
  cached = parsed.data;
  return cached;
}
