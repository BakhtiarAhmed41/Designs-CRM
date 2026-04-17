import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getEnv } from '../config/env';

function stripSslmode(url: string): string {
  // If a URL includes sslmode=require/verify-full, pg-connection-string may enforce stricter semantics.
  // We strip it when we explicitly control TLS verification via Pool.ssl options.
  let out = url.replace(/([?&])sslmode=[^&]+&?/i, '$1');
  out = out.replace(/[?&]$/, '');
  out = out.replace(/\?&/, '?');
  return out;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const env = getEnv();
    const connectionString = env.DATABASE_SSL_REJECT_UNAUTHORIZED ? env.DATABASE_URL : stripSslmode(env.DATABASE_URL);
    const pool = new Pool({
      connectionString,
      ssl: env.DATABASE_SSL_REJECT_UNAUTHORIZED ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}

