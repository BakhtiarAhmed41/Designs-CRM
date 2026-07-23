import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { DbService } from '../db/db.service';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
};

@Injectable()
export class NotificationsService {
  constructor(private db: DbService) {}

  async createFor(
    userId: string,
    input: { title: string; body?: string | null; link?: string | null },
  ) {
    await this.db.execute(
      'INSERT INTO notifications (id, user_id, title, body, link) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), userId, input.title, input.body ?? null, input.link ?? null],
    );
  }

  async createForMany(
    userIds: string[],
    input: { title: string; body?: string | null; link?: string | null },
  ) {
    if (userIds.length === 0) return;
    const values = userIds.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const uid of userIds) {
      params.push(randomUUID(), uid, input.title, input.body ?? null, input.link ?? null);
    }
    await this.db.execute(
      `INSERT INTO notifications (id, user_id, title, body, link) VALUES ${values}`,
      params,
    );
  }

  async list(user: AuthUser | undefined) {
    assertAuthUser(user);
    const items = await this.db.query<NotificationRow>(
      'SELECT id, user_id, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 15',
      [user.id],
    );
    const countRow = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [user.id],
    );
    return {
      notifications: items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.read_at,
        createdAt: n.created_at,
      })),
      unreadCount: Number(countRow?.n ?? 0),
    };
  }

  async markRead(user: AuthUser | undefined, id: string) {
    assertAuthUser(user);
    await this.db.execute(
      'UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ? AND read_at IS NULL',
      [id, user.id],
    );
    return { ok: true };
  }

  async markAllRead(user: AuthUser | undefined) {
    assertAuthUser(user);
    await this.db.execute(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL',
      [user.id],
    );
    return { ok: true };
  }
}
