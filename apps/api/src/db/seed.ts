import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import mysql from 'mysql2/promise';
import { getEnv } from '../config/env';
import { UserRole } from '../common/enums';

/**
 * Seed baseline users (team) + sample customers/orders/quotes so both the
 * admin command center and the customer portal render immediately.
 * Idempotent: users are upserted by email; sample data only inserted once.
 */
const DEFAULT_PASSWORD = 'Password123!';

async function main() {
  const env = getEnv();
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });

  const pwHash = await argon2.hash(DEFAULT_PASSWORD);

  const staff: Array<{
    email: string;
    role: UserRole;
    first: string;
    initials: string;
    presence: string;
    skills: string[];
  }> = [
    { email: 'qasim@lvd.test', role: UserRole.SUPER_ADMIN, first: 'Qasim', initials: 'QA', presence: 'ON', skills: ['Owner'] },
    { email: 'sam@lvd.test', role: UserRole.ADMIN, first: 'Sam', initials: 'SM', presence: 'ON', skills: ['Operations'] },
    { email: 'lina@lvd.test', role: UserRole.SUPPORT, first: 'Lina', initials: 'Li', presence: 'ON', skills: ['Support'] },
    { email: 'ahmed@lvd.test', role: UserRole.DESIGNER, first: 'Ahmed', initials: 'Ah', presence: 'ON', skills: ['Embroidery'] },
    { email: 'priya@lvd.test', role: UserRole.DESIGNER, first: 'Priya', initials: 'Pr', presence: 'AWAY', skills: ['SVG', 'Vector'] },
    { email: 'chen@lvd.test', role: UserRole.DESIGNER, first: 'Chen', initials: 'Ch', presence: 'OFF', skills: ['CNC/Laser', 'Vector'] },
  ];

  for (const s of staff) {
    await conn.execute(
      `INSERT INTO users (id, email, password_hash, role, first_name, initials, presence, skills)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), first_name = VALUES(first_name),
         initials = VALUES(initials), presence = VALUES(presence), skills = VALUES(skills)`,
      [randomUUID(), s.email, pwHash, s.role, s.first, s.initials, s.presence, JSON.stringify(s.skills)],
    );
  }

  // Env-configured admin (optional) - kept for backwards compatibility.
  if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
    const adminHash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
    await conn.execute(
      `INSERT INTO users (id, email, password_hash, role, first_name, initials, presence)
       VALUES (?, ?, ?, 'ADMIN', 'Admin', 'AD', 'ON')
       ON DUPLICATE KEY UPDATE role = 'ADMIN'`,
      [randomUUID(), env.SEED_ADMIN_EMAIL.toLowerCase(), adminHash],
    );
  }

  // Sample client user (customer login).
  const clientId = randomUUID();
  await conn.execute(
    `INSERT INTO users (id, email, password_hash, role, first_name, initials, presence)
     VALUES (?, 'sara@client.test', ?, 'CLIENT', 'Sara', 'SA', 'OFF')
     ON DUPLICATE KEY UPDATE first_name = 'Sara'`,
    [clientId, pwHash],
  );
  const [clientRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id FROM users WHERE email = 'sara@client.test' LIMIT 1`,
  );
  const saraId = clientRows[0]?.id as string;

  // Only insert sample customers/orders once.
  const [custCount] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM customers',
  );
  if ((custCount[0]?.n ?? 0) === 0) {
    const customers: Array<[string, string, string, string, string | null, number]> = [
      // [id, name, accountType, source, netTerms, storeCreditCents]
      [randomUUID(), 'Stitch & Press Co.', 'NET_MONTHLY', 'PORTAL', 'NET_15', 0],
      [randomUUID(), 'Tempo Threads', 'NET_MONTHLY', 'PORTAL', 'NET_30', 0],
      [randomUUID(), "Mike's Caps", 'PAY_PER_ORDER', 'GUEST', null, 2400],
      [randomUUID(), 'Riverside FC', 'PAY_PER_ORDER', 'PORTAL', null, 0],
    ];
    for (const c of customers) {
      await conn.execute(
        `INSERT INTO customers (id, name, account_type, source, net_terms, store_credit_cents, since_date)
         VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
        c,
      );
    }

    // Link Sara to a portal customer.
    const saraCustomerId = randomUUID();
    await conn.execute(
      `INSERT INTO customers (id, user_id, name, email, account_type, source, since_date)
       VALUES (?, ?, 'Sara (Portal)', 'sara@client.test', 'PAY_PER_ORDER', 'PORTAL', CURDATE())`,
      [saraCustomerId, saraId],
    );

    // A couple of sample orders for Sara.
    const o1 = randomUUID();
    await conn.execute(
      `INSERT INTO orders (id, human_ref, customer_id, client_user_id, type, service_type, name, status, price_cents, currency)
       VALUES (?, '1043', ?, ?, 'ORDER', 'EMBROIDERY', 'Eagle crest - left chest + cap', 'IN_PROGRESS', 2400, 'USD')`,
      [o1, saraCustomerId, saraId],
    );
    const o2 = randomUUID();
    await conn.execute(
      `INSERT INTO orders (id, human_ref, customer_id, client_user_id, type, service_type, name, status)
       VALUES (?, 'Q-209', ?, ?, 'QUOTE_REQUEST', 'EMBROIDERY', 'Team crest - Oak United', 'WAITING_FOR_QUOTATION')`,
      [o2, saraCustomerId, saraId],
    );
  }

  await conn.end();
  // eslint-disable-next-line no-console
  console.log(`Seed complete. Default password for sample accounts: ${DEFAULT_PASSWORD}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
