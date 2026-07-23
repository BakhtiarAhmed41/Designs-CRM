import { Injectable } from '@nestjs/common';
import { DbService } from './db/db.service';

@Injectable()
export class AppService {
  constructor(private db: DbService) {}

  health(): { ok: true } {
    return { ok: true };
  }

  async healthDb(): Promise<{ ok: true; users: number }> {
    const row = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM users',
    );
    return { ok: true, users: Number(row?.n ?? 0) };
  }
}
