import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { getEnv } from '../config/env';

async function main() {
  const env = getEnv();
  const prisma = new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: env.DATABASE_URL })),
  });

  if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const passwordHash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
      await prisma.user.create({
        data: { email, passwordHash, role: UserRole.ADMIN },
      });
      // eslint-disable-next-line no-console
      console.log(`Seeded admin user: ${email}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

