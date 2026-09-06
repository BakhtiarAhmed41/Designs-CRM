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

  async function indexExists(table: string, indexName: string): Promise<boolean> {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [env.DB_NAME, table, indexName],
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
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

  if (!(await columnExists('conversations', 'hidden_from_client'))) {
    // eslint-disable-next-line no-console
    console.log('Adding conversations.hidden_from_client column ...');
    await conn.query(
      'ALTER TABLE conversations ADD COLUMN hidden_from_client TINYINT(1) NOT NULL DEFAULT 0',
    );
  }

  if (!(await columnExists('conversations', 'private_notes'))) {
    // eslint-disable-next-line no-console
    console.log('Adding conversations.private_notes column ...');
    await conn.query(
      'ALTER TABLE conversations ADD COLUMN private_notes TEXT NULL',
    );
  }

  if (!(await columnExists('conversations', 'starred_admin'))) {
    // eslint-disable-next-line no-console
    console.log('Adding conversations.starred_admin column ...');
    await conn.query(
      'ALTER TABLE conversations ADD COLUMN starred_admin TINYINT(1) NOT NULL DEFAULT 0',
    );
  }

  if (!(await columnExists('conversations', 'starred_client'))) {
    // eslint-disable-next-line no-console
    console.log('Adding conversations.starred_client column ...');
    await conn.query(
      'ALTER TABLE conversations ADD COLUMN starred_client TINYINT(1) NOT NULL DEFAULT 0',
    );
  }

  if (!(await columnExists('messages', 'deleted_at'))) {
    // eslint-disable-next-line no-console
    console.log('Adding messages.deleted_at column ...');
    await conn.query(
      'ALTER TABLE messages ADD COLUMN deleted_at DATETIME NULL',
    );
  }

  // Expand invoices.status ENUM (safe to re-run).
  // eslint-disable-next-line no-console
  console.log('Ensuring invoices.status includes PARTIAL and CANCELLED ...');
  await conn.query(
    `ALTER TABLE invoices MODIFY COLUMN status
       ENUM('AWAITING','PARTIAL','PAID','CANCELLED') NOT NULL DEFAULT 'AWAITING'`,
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

  if (!(await columnExists('deliveries', 'released_at'))) {
    console.log('Adding deliveries.released_at column ...');
    await conn.query(
      'ALTER TABLE deliveries ADD COLUMN released_at DATETIME NULL',
    );
    await conn.query(
      'UPDATE deliveries SET released_at = created_at WHERE released_at IS NULL',
    );
  }

  if (!(await columnExists('edit_requests', 'design_ids'))) {
    console.log('Adding edit_requests.design_ids column ...');
    await conn.query('ALTER TABLE edit_requests ADD COLUMN design_ids JSON NULL');
  }

  if (!(await columnExists('payments', 'stripe_checkout_session_id'))) {
    console.log('Adding payments.stripe_checkout_session_id column ...');
    await conn.query(
      'ALTER TABLE payments ADD COLUMN stripe_checkout_session_id VARCHAR(255) NULL',
    );
  }
  if (!(await columnExists('payments', 'stripe_payment_intent_id'))) {
    console.log('Adding payments.stripe_payment_intent_id column ...');
    await conn.query(
      'ALTER TABLE payments ADD COLUMN stripe_payment_intent_id VARCHAR(255) NULL',
    );
  }
  if (!(await indexExists('payments', 'uq_stripe_session'))) {
    console.log('Adding payments.uq_stripe_session index ...');
    await conn.query(
      'ALTER TABLE payments ADD UNIQUE KEY uq_stripe_session (stripe_checkout_session_id)',
    );
  }

  if (!(await columnExists('format_requests', 'resolved_at'))) {
    console.log('Adding format_requests.resolved_at column ...');
    await conn.query(
      'ALTER TABLE format_requests ADD COLUMN resolved_at DATETIME NULL',
    );
  }

  if (!(await columnExists('format_requests', 'invoice_id'))) {
    console.log('Adding format_requests.invoice_id column ...');
    await conn.query(
      'ALTER TABLE format_requests ADD COLUMN invoice_id CHAR(36) NULL',
    );
  }
  if (!(await columnExists('format_requests', 'price_cents'))) {
    console.log('Adding format_requests.price_cents column ...');
    await conn.query(
      'ALTER TABLE format_requests ADD COLUMN price_cents INT NULL',
    );
  }

  const [kindCols] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'kind'`,
    [env.DB_NAME],
  );
  const kindType = String(kindCols[0]?.t ?? '');
  if (kindType && !kindType.includes('ADD_ON')) {
    console.log('Adding invoices.kind ADD_ON ...');
    await conn.query(
      "ALTER TABLE invoices MODIFY COLUMN kind ENUM('PER_ORDER','MONTHLY','ADD_ON') NOT NULL DEFAULT 'PER_ORDER'",
    );
  }

  if (!(await columnExists('quotation_lines', 'attachment_id'))) {
    console.log('Adding quotation_lines.attachment_id column ...');
    await conn.query(
      'ALTER TABLE quotation_lines ADD COLUMN attachment_id CHAR(36) NULL',
    );
  }

  const [labelCols] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'conversations' AND COLUMN_NAME = 'label'`,
    [env.DB_NAME],
  );
  const labelType = String(labelCols[0]?.t ?? '');
  if (labelType && !labelType.includes('HELP')) {
    console.log('Adding conversations.label HELP ...');
    await conn.query(
      `ALTER TABLE conversations MODIFY COLUMN label
         ENUM('EDIT','PAYMENT','CUSTOM','IMPORTANT','HELP') NULL`,
    );
  }

  if (!(await columnExists('orders', 'created_by_role'))) {
    console.log('Adding orders.created_by_role column ...');
    await conn.query(
      `ALTER TABLE orders ADD COLUMN created_by_role ENUM('SUPER_ADMIN','ADMIN','SUPPORT','DESIGNER','CLIENT') NULL`,
    );
  }
  if (!(await columnExists('orders', 'created_by_id'))) {
    console.log('Adding orders.created_by_id column ...');
    await conn.query('ALTER TABLE orders ADD COLUMN created_by_id CHAR(36) NULL');
  }

  const [invStatusCols] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'status'`,
    [env.DB_NAME],
  );
  const invStatusType = String(invStatusCols[0]?.t ?? '');
  if (invStatusType && !invStatusType.includes('PARTIAL')) {
    console.log('Adding invoices.status PARTIAL ...');
    await conn.query(
      "ALTER TABLE invoices MODIFY COLUMN status ENUM('AWAITING','PARTIAL','PAID','CANCELLED') NOT NULL DEFAULT 'AWAITING'",
    );
  }
  if (!(await columnExists('invoices', 'amount_paid_cents'))) {
    console.log('Adding invoices.amount_paid_cents column ...');
    await conn.query(
      'ALTER TABLE invoices ADD COLUMN amount_paid_cents INT NOT NULL DEFAULT 0',
    );
    await conn.query(
      "UPDATE invoices SET amount_paid_cents = amount_cents WHERE status = 'PAID' AND amount_paid_cents = 0",
    );
  } else {
    await conn.query(
      "UPDATE invoices SET amount_paid_cents = amount_cents WHERE status = 'PAID' AND amount_paid_cents = 0",
    );
  }
  if (!(await columnExists('invoices', 'due_at'))) {
    console.log('Adding invoices.due_at column ...');
    await conn.query('ALTER TABLE invoices ADD COLUMN due_at DATETIME NULL');
  }

  const [invLineTables] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoice_lines'`,
    [env.DB_NAME],
  );
  if (Number(invLineTables[0]?.cnt ?? 0) === 0) {
    console.log('Creating invoice_lines table ...');
    await conn.query(`
      CREATE TABLE invoice_lines (
        id           CHAR(36) NOT NULL,
        invoice_id   CHAR(36) NOT NULL,
        order_id     CHAR(36) NULL,
        description  VARCHAR(255) NOT NULL,
        amount_cents INT NOT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_inv_line_invoice (invoice_id),
        UNIQUE KEY uq_inv_line_order (order_id),
        CONSTRAINT fk_inv_line_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
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
