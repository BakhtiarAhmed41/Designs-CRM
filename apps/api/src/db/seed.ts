import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import mysql from 'mysql2/promise';
import { getEnv } from '../config/env';

/**
 * Seeds optional env-configured admin + the Sara portal sample customer.
 * Demo staff (@lvd.test) are not seeded — create real team accounts in the app.
 */
const SARA_EMAIL = 'sara@client.test';
const SARA_PASSWORD = 'Password123!';

async function main() {
  const env = getEnv();
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });

  if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
    const adminHash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
    await conn.execute(
      `INSERT INTO users (id, email, password_hash, role, first_name, initials, presence, login_status)
       VALUES (?, ?, ?, 'SUPER_ADMIN', 'Admin', 'AD', 'ON', 'ACTIVE')
       ON DUPLICATE KEY UPDATE role = 'SUPER_ADMIN', login_status = 'ACTIVE', password_hash = VALUES(password_hash)`,
      [randomUUID(), env.SEED_ADMIN_EMAIL.toLowerCase(), adminHash],
    );
    // eslint-disable-next-line no-console
    console.log(`Admin ensured: ${env.SEED_ADMIN_EMAIL}`);
  }

  const saraHash = await argon2.hash(SARA_PASSWORD);
  await conn.execute(
    `INSERT INTO users (id, email, password_hash, role, first_name, initials, presence)
     VALUES (?, ?, ?, 'CLIENT', 'Sara', 'SA', 'OFF')
     ON DUPLICATE KEY UPDATE first_name = 'Sara', initials = 'SA'`,
    [randomUUID(), SARA_EMAIL, saraHash],
  );
  const [clientRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    [SARA_EMAIL],
  );
  const saraId = clientRows[0]?.id as string;

  const [existingCust] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id FROM customers WHERE email = ? OR name = 'Sara (Portal)' LIMIT 1`,
    [SARA_EMAIL],
  );
  let saraCustomerId = existingCust[0]?.id as string | undefined;
  if (saraCustomerId) {
    await conn.execute(
      `UPDATE customers SET user_id = ?, email = ?, name = 'Sara (Portal)' WHERE id = ?`,
      [saraId, SARA_EMAIL, saraCustomerId],
    );
  } else {
    saraCustomerId = randomUUID();
    await conn.execute(
      `INSERT INTO customers (id, user_id, name, email, account_type, source, since_date)
       VALUES (?, ?, 'Sara (Portal)', ?, 'PAY_PER_ORDER', 'PORTAL', CURDATE())`,
      [saraCustomerId, saraId, SARA_EMAIL],
    );
  }

  const [orderCount] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?`,
    [saraCustomerId],
  );
  if ((orderCount[0]?.n ?? 0) === 0) {
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
  } else {
    await conn.execute(
      `UPDATE orders SET client_user_id = ? WHERE customer_id = ? AND client_user_id IS NULL`,
      [saraId, saraCustomerId],
    );
  }

  await conn.end();
  // eslint-disable-next-line no-console
  console.log(`Seed complete. Sara portal login: ${SARA_EMAIL} / ${SARA_PASSWORD}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
