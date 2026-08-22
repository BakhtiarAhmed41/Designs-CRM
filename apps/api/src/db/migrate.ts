import 'dotenv/config';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import mysql from 'mysql2/promise';
import { getEnv } from '../config/env';

/**
 * Minimal migration runner (no ORM).
 * 1. Creates the database if it does not exist.
 * 2. Applies db/schema.sql (idempotent CREATE TABLE IF NOT EXISTS).
 * 3. Applies any numbered db/migrations/*.sql not yet recorded in _migrations.
 *
 * You can also paste these .sql files straight into phpMyAdmin.
 */
async function main() {
  const env = getEnv();
  const dbRoot = join(__dirname, '..', '..', 'db');
  const schemaPath = join(dbRoot, 'schema.sql');
  const migrationsDir = join(dbRoot, 'migrations');

  // Connect without a database first so we can create it.
  const root = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: true,
  });
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await root.end();

  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true,
  });

  await conn.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name VARCHAR(255) NOT NULL,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (name)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  if (existsSync(schemaPath)) {
    // eslint-disable-next-line no-console
    console.log('Applying schema.sql ...');
    await conn.query(readFileSync(schemaPath, 'utf8'));
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const [cols] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [env.DB_NAME, table, column],
    );
    return Number(cols[0]?.cnt ?? 0) > 0;
  }

  if (!(await columnExists('customers', 'preferences'))) {
    // eslint-disable-next-line no-console
    console.log('Adding customers.preferences column ...');
    await conn.query('ALTER TABLE customers ADD COLUMN preferences JSON NULL');
  }

  if (!(await columnExists('orders', 'internal_notes'))) {
    // eslint-disable-next-line no-console
    console.log('Adding orders.internal_notes column ...');
    await conn.query('ALTER TABLE orders ADD COLUMN internal_notes TEXT NULL');
  }

  if (!(await columnExists('conversations', 'archived'))) {
    // eslint-disable-next-line no-console
    console.log('Adding conversations.archived column ...');
    await conn.query(
      'ALTER TABLE conversations ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0',
    );
  }

  if (!(await columnExists('conversations', 'private_notes'))) {
    // eslint-disable-next-line no-console
    console.log('Adding conversations.private_notes column ...');
    await conn.query(
      'ALTER TABLE conversations ADD COLUMN private_notes TEXT NULL',
    );
  }

  // Expand invoices.status ENUM to include CANCELLED (safe to re-run).
  // eslint-disable-next-line no-console
  console.log('Ensuring invoices.status includes CANCELLED ...');
  await conn.query(
    `ALTER TABLE invoices MODIFY COLUMN status
       ENUM('AWAITING','PAID','CANCELLED') NOT NULL DEFAULT 'AWAITING'`,
  );

  if (!(await columnExists('quotation_lines', 'client_decision'))) {
    // eslint-disable-next-line no-console
    console.log('Adding quotation_lines.client_decision column ...');
    await conn.query(
      `ALTER TABLE quotation_lines ADD COLUMN client_decision
         ENUM('PENDING','KEPT','DROPPED') NOT NULL DEFAULT 'PENDING'`,
    );
  }

  if (!(await columnExists('users', 'login_status'))) {
    // eslint-disable-next-line no-console
    console.log('Adding users.login_status column ...');
    await conn.query(
      `ALTER TABLE users ADD COLUMN login_status
         ENUM('PENDING','ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE'`,
    );
  }

  if (!(await columnExists('users', 'custom_role_id'))) {
    // eslint-disable-next-line no-console
    console.log('Adding users.custom_role_id column ...');
    await conn.query(
      'ALTER TABLE users ADD COLUMN custom_role_id CHAR(36) NULL',
    );
  }

  if (!(await columnExists('users', 'email_verified_at'))) {
    // eslint-disable-next-line no-console
    console.log('Adding users.email_verified_at column ...');
    await conn.query(
      'ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL',
    );
  }

  if (!(await columnExists('users', 'pending_email'))) {
    console.log('Adding users.pending_email column ...');
    await conn.query('ALTER TABLE users ADD COLUMN pending_email VARCHAR(255) NULL');
  }

  if (!(await columnExists('orders', 'turnaround_key'))) {
    console.log('Adding orders.turnaround columns ...');
    await conn.query(
      `ALTER TABLE orders
         ADD COLUMN turnaround_key VARCHAR(40) NULL,
         ADD COLUMN turnaround_label VARCHAR(120) NULL,
         ADD COLUMN turnaround_hours INT NULL`,
    );
  }

  if (!(await columnExists('quotation_lines', 'attachment_id'))) {
    console.log('Adding quotation_lines.attachment_id column ...');
    await conn.query(
      'ALTER TABLE quotation_lines ADD COLUMN attachment_id CHAR(36) NULL',
    );
  }

  if (existsSync(migrationsDir)) {
    const applied = new Set(
      (
        await conn.query<mysql.RowDataPacket[]>('SELECT name FROM _migrations')
      )[0].map((r) => r.name as string),
    );
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      // eslint-disable-next-line no-console
      console.log(`Applying migration ${file} ...`);
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await conn.query(sql);
      await conn.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
    }
  }

  await conn.end();
  // eslint-disable-next-line no-console
  console.log('Migrations complete.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
