import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { normalizePage, pageResult } from '../common/pagination';
import { DbService } from '../db/db.service';
import { NotificationEvents } from './notification.events';

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

type OrderMeta = { name: string | null; humanRef: string | null };

const GENERIC_DESIGN =
  /^(your order|your quote|your invoice|your account|the portal|quote request)$/i;

function parseActivityLink(link: string | null) {
  const orderIds: string[] = [];
  const refs: string[] = [];
  let conversationId: string | null = null;
  if (!link) return { orderIds, refs, conversationId };
  try {
    const url = new URL(link, 'http://local');
    const pathToken = url.pathname.match(/\/(?:orders|quotes)\/([^/]+)/)?.[1] ?? null;
    for (const token of [url.searchParams.get('order'), pathToken]) {
      if (!token) continue;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
        orderIds.push(token);
      } else if (/^\d{6,12}$/.test(token)) {
        refs.push(token);
      }
    }
    const convo = url.searchParams.get('c');
    if (convo && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convo)) {
      conversationId = convo;
    }
  } catch {
    /* malformed link */
  }
  return { orderIds, refs, conversationId };
}

function cleanDesign(value: string | null | undefined) {
  const name = value?.trim().replace(/\.$/, '') ?? '';
  if (!name || GENERIC_DESIGN.test(name) || /^#?\d{6,12}$/.test(name)) return null;
  return name;
}

function designFromBody(title: string, body: string | null) {
  if (!body?.trim() || title.toLowerCase().includes('message')) return null;
  const dashed = body.match(/\s[-–—]\s+([^.]+)$/);
  const fromDash = cleanDesign(dashed?.[1]);
  if (fromDash) return fromDash;
  const patterns = [
    /\bfor ([^.]+?) are\b/i,
    /\bfor ([^.]+?) is\b/i,
    /\bfor ([^.]+?) were\b/i,
    /\bfor ([^.]+?)\.?$/i,
    /\bon ([^.]+?)\.?$/i,
  ];
  for (const pattern of patterns) {
    const name = cleanDesign(body.match(pattern)?.[1]);
    if (name) return name;
  }
  return null;
}

function refFromBody(body: string | null) {
  const match = body?.match(/#?(\d{6,12})/);
  return match?.[1] ?? null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private db: DbService,
    private events: NotificationEvents,
  ) {}

  async createFor(
    userId: string,
    input: { title: string; body?: string | null; link?: string | null },
  ) {
    await this.db.execute(
      'INSERT INTO notifications (id, user_id, title, body, link) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), userId, input.title, input.body ?? null, input.link ?? null],
    );
    this.events.emitCreated(userId);
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
    for (const uid of userIds) {
      this.events.emitCreated(uid);
    }
  }

  async list(
    user: AuthUser | undefined,
    paging?: { page?: number; pageSize?: number; dismissed?: boolean },
  ) {
    assertAuthUser(user);
    const { page, pageSize, offset } = normalizePage({
      page: paging?.page,
      pageSize: paging?.pageSize ?? 10,
    });
    const dismissedOnly = paging?.dismissed === true;
    const visibility = dismissedOnly
      ? 'dismissed_at IS NOT NULL'
      : 'dismissed_at IS NULL';
    const items = await this.db.query<NotificationRow>(
      `SELECT id, user_id, title, body, link, read_at, created_at
         FROM notifications
        WHERE user_id = ? AND ${visibility}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [user.id, pageSize, offset],
    );
    const totalRow = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ${visibility}`,
      [user.id],
    );
    const countRow = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL',
      [user.id],
    );
    const dismissedRow = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND dismissed_at IS NOT NULL',
      [user.id],
    );
    const meta = await this.orderMetaFor(items.map((n) => n.link));
    const mapped = items.map((n) => {
      const keys = parseActivityLink(n.link);
      const hit =
        keys.orderIds.map((id) => meta.byId.get(id)).find(Boolean) ??
        keys.refs.map((ref) => meta.byRef.get(ref)).find(Boolean) ??
        (keys.conversationId ? meta.byConversation.get(keys.conversationId) : undefined);
      return {
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.read_at,
        createdAt: n.created_at,
        designName: hit?.name ?? designFromBody(n.title, n.body),
        humanRef: hit?.humanRef ?? refFromBody(n.body),
      };
    });
    return {
      ...pageResult(mapped, Number(totalRow?.n ?? 0), page, pageSize),
      notifications: mapped,
      unreadCount: Number(countRow?.n ?? 0),
      dismissedCount: Number(dismissedRow?.n ?? 0),
    };
  }

  async dismiss(user: AuthUser | undefined, id: string) {
    assertAuthUser(user);
    await this.db.execute(
      'UPDATE notifications SET dismissed_at = NOW() WHERE id = ? AND user_id = ? AND dismissed_at IS NULL',
      [id, user.id],
    );
    return { ok: true };
  }

  async restore(user: AuthUser | undefined, id: string) {
    assertAuthUser(user);
    await this.db.execute(
      'UPDATE notifications SET dismissed_at = NULL WHERE id = ? AND user_id = ?',
      [id, user.id],
    );
    return { ok: true };
  }

  private async orderMetaFor(links: Array<string | null>) {
    const ids = new Set<string>();
    const refs = new Set<string>();
    const convos = new Set<string>();
    for (const link of links) {
      const keys = parseActivityLink(link);
      keys.orderIds.forEach((id) => ids.add(id));
      keys.refs.forEach((ref) => refs.add(ref));
      if (keys.conversationId) convos.add(keys.conversationId);
    }
    const byId = new Map<string, OrderMeta>();
    const byRef = new Map<string, OrderMeta>();
    const byConversation = new Map<string, OrderMeta>();
    if (ids.size > 0) {
      const list = [...ids];
      const rows = await this.db.query<{ id: string; name: string | null; human_ref: string | null }>(
        `SELECT id, name, human_ref FROM orders WHERE id IN (${list.map(() => '?').join(',')})`,
        list,
      );
      for (const row of rows) {
        byId.set(row.id, { name: cleanDesign(row.name), humanRef: row.human_ref });
      }
    }
    if (refs.size > 0) {
      const list = [...refs];
      const rows = await this.db.query<{ id: string; name: string | null; human_ref: string | null }>(
        `SELECT id, name, human_ref FROM orders WHERE human_ref IN (${list.map(() => '?').join(',')})`,
        list,
      );
      for (const row of rows) {
        if (row.human_ref) {
          byRef.set(row.human_ref, { name: cleanDesign(row.name), humanRef: row.human_ref });
        }
      }
    }
    if (convos.size > 0) {
      const list = [...convos];
      const rows = await this.db.query<{
        id: string;
        name: string | null;
        human_ref: string | null;
      }>(
        `SELECT c.id, o.name, o.human_ref
           FROM conversations c
           LEFT JOIN orders o ON o.id = c.order_id
          WHERE c.id IN (${list.map(() => '?').join(',')})`,
        list,
      );
      for (const row of rows) {
        byConversation.set(row.id, { name: cleanDesign(row.name), humanRef: row.human_ref });
      }
    }
    return { byId, byRef, byConversation };
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

  async markConversationRead(userId: string, conversationId: string) {
    await this.db.execute(
      `UPDATE notifications
          SET read_at = NOW()
        WHERE user_id = ?
          AND read_at IS NULL
          AND (
            link = ?
            OR link LIKE ?
          )`,
      [
        userId,
        `/portal/messages?c=${conversationId}`,
        `%c=${conversationId}%`,
      ],
    );
    this.events.emitCreated(userId);
  }

  async markFileReadyRead(userId: string, orderId: string) {
    const orderLink = `/portal/orders/${orderId}`;
    await this.db.execute(
      `UPDATE notifications
          SET read_at = NOW()
        WHERE user_id = ?
          AND read_at IS NULL
          AND (
            title = 'Your files are ready'
            OR title LIKE '%files are ready%'
            OR body LIKE '%ready to download%'
          )
          AND (link = ? OR link LIKE ?)`,
      [userId, orderLink, `%/orders/${orderId}%`],
    );
    this.events.emitCreated(userId);
  }
}
