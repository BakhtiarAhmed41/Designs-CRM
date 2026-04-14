import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getEnv } from '../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const env = getEnv();
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL_REJECT_UNAUTHORIZED ? undefined : { rejectUnauthorized: false },
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}

