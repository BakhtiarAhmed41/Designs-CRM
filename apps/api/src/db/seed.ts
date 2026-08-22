import 'dotenv/config';
import { getEnv } from '../config/env';

/**
 * No demo customers, orders, or staff are created here.
 * The only optional user is the env admin, created on API boot by AuthService.ensureSeedAdmin.
 */
async function main() {
  const env = getEnv();
  if (env.SEED_ADMIN_EMAIL) {
    // eslint-disable-next-line no-console
    console.log(
      `No demo seed. On API start, a SUPER_ADMIN is created only if missing: ${env.SEED_ADMIN_EMAIL}`,
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.log('No demo seed. SEED_ADMIN_EMAIL is empty — no users will be created.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
