import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import mysql, {
  type ExecuteValues,
  type Pool,
  type PoolConnection,
  type QueryValues,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import { getEnv } from '../config/env';

const TRANSIENT_DB_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'ER_SERVER_SHUTDOWN',
]);

function isTransientDbError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  return TRANSIENT_DB_CODES.has(code);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransientDbError(err)) throw err;
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Thin wrapper around a single mysql2 connection pool.
 * All persistence in the app goes through these helpers with hand-written,
 * parameterized SQL. No ORM, no query builder, no codegen.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private _pool: Pool | null = null;

  get pool(): Pool {
    if (!this._pool) {
      const env = getEnv();
      this._pool = mysql.createPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        connectionLimit: env.DB_CONNECTION_LIMIT,
        waitForConnections: true,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        idleTimeout: 60_000,
        maxIdle: Math.min(env.DB_CONNECTION_LIMIT, 5),
        namedPlaceholders: false,
        dateStrings: false,
        supportBigNumbers: true,
        charset: 'utf8mb4',
      });
    }
    return this._pool;
  }

  async onModuleInit(): Promise<void> {
    // Touch the pool early so misconfiguration surfaces at boot.
    try {
      await this.pool.query('SELECT 1');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('MySQL not reachable yet.', (err as Error)?.message ?? err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }

  /** Generate an application-side UUID for CHAR(36) primary keys. */
  uuid(): string {
    return randomUUID();
  }

  /** Run a SELECT and return all rows typed as T. */
  async query<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
    return withRetry(async () => {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        sql,
        params as QueryValues,
      );
      return rows as unknown as T[];
    });
  }

  /** Run a SELECT and return the first row (or null). */
  async queryOne<T = RowDataPacket>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length ? rows[0] : null;
  }

  /** Run an INSERT/UPDATE/DELETE and return the raw result header. */
  async execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
    return withRetry(async () => {
      const [result] = await this.pool.execute<ResultSetHeader>(
        sql,
        params as ExecuteValues,
      );
      return result;
    });
  }

  /**
   * Run a set of statements inside a single transaction.
   * The callback receives a dedicated connection with the same helpers.
   */
  async withTransaction<T>(
    fn: (tx: DbTransaction) => Promise<T>,
  ): Promise<T> {
    return withRetry(async () => {
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(new DbTransaction(conn));
        await conn.commit();
        return result;
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          /* ignore rollback errors */
        }
        throw err;
      } finally {
        conn.release();
      }
    });
  }
}

/** Transaction-scoped query helpers backed by a single connection. */
export class DbTransaction {
  constructor(private readonly conn: PoolConnection) {}

  async query<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.conn.query<RowDataPacket[]>(
      sql,
      params as QueryValues,
    );
    return rows as unknown as T[];
  }

  async queryOne<T = RowDataPacket>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length ? rows[0] : null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
    const [result] = await this.conn.execute<ResultSetHeader>(
      sql,
      params as ExecuteValues,
    );
    return result;
  }
}
