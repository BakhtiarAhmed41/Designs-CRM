import * as bcrypt from 'bcryptjs';

const ROUNDS = 10;

/** Hash a password or refresh token. Pure JS - no native build on Hostinger. */
export async function hashSecret(value: string): Promise<string> {
  return bcrypt.hash(value, ROUNDS);
}

/** Verify a bcrypt hash. Argon2 hashes from older deploys will not match. */
export async function verifySecret(
  hash: string,
  value: string,
): Promise<boolean> {
  if (!hash?.startsWith('$2')) return false;
  try {
    return await bcrypt.compare(value, hash);
  } catch {
    return false;
  }
}
