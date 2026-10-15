import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { normalizePage, pageResult } from '../common/pagination';
import { DbService } from '../db/db.service';
import { NotificationEvents } from './notification.events';
import { activityType, groupActivities, needsActivityAction } from './activity-groups';

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
  dismissed_at: Date | null;
  completed_at: Date | null;
  completion_label: string | null;
};

type OrderMeta = { orderId: string | null; name: string | null; humanRef: string | null };

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
    paging?: { page?: number; pageSize?: number; dismissed?: boolean; grouped?: boolean },
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
      `SELECT id, user_id, title, body, link, read_at, created_at, dismissed_at, completed_at, completion_label
         FROM notifications
        WHERE user_id = ?${paging?.grouped ? '' : ` AND ${visibility}`}
        ORDER BY created_at DESC, id DESC
        ${paging?.grouped ? '' : 'LIMIT ? OFFSET ?'}`,
      paging?.grouped ? [user.id] : [user.id, pageSize, offset],
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
    let mapped = items.map((n) => {
      const keys = parseActivityLink(n.link);
      const hit =
        keys.orderIds.map((id) => meta.byId.get(id)).find(Boolean) ??
        keys.refs.map((ref) => meta.byRef.get(ref)).find(Boolean) ??
        (keys.conversationId ? meta.byConversation.get(keys.conversationId) : undefined) ??
        meta.byInvoice.get(this.invoiceIdFromLink(n.link) ?? '');
      return {
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.read_at,
        createdAt: n.created_at,
        designName: hit?.name ?? designFromBody(n.title, n.body),
        humanRef: hit?.humanRef ?? keys.refs[0] ?? (activityType(n.title) === 'message' ? null : refFromBody(n.body)),
        orderId: hit?.orderId ?? keys.orderIds[0] ?? null,
        dismissedAt: n.dismissed_at,
        completedAt: n.completed_at,
        completionLabel: n.completion_label,
        requiresAction: needsActivityAction(n.title),
        invoiceId: this.invoiceIdFromLink(n.link),
      };
    });
    if (paging?.grouped) {
      mapped = await this.withActionHistory(user.id, mapped);
      const active = groupActivities(mapped.filter((n) => !n.dismissedAt));
      const dismissed = groupActivities(mapped.filter((n) => Boolean(n.dismissedAt)));
      const groups = dismissedOnly ? dismissed : active;
      const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
      const currentPage = Math.min(page, totalPages);
      const start = (currentPage - 1) * pageSize;
      const notifications = groups.slice(start, start + pageSize);
      return {
        ...pageResult(notifications, groups.length, currentPage, pageSize),
        notifications,
        unreadCount: Number(countRow?.n ?? 0),
        dismissedCount: dismissed.length,
      };
    }
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

  async updateBatch(user: AuthUser | undefined, ids: string[], action: 'read' | 'dismiss' | 'restore') {
    assertAuthUser(user);
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return { ok: true };
    const assignment = action === 'read'
      ? 'read_at = COALESCE(read_at, NOW())'
      : action === 'dismiss' ? 'dismissed_at = NOW()' : 'dismissed_at = NULL';
    await this.db.execute(
      `UPDATE notifications SET ${assignment} WHERE user_id = ? AND id IN (${uniqueIds.map(() => '?').join(',')})`,
      [user.id, ...uniqueIds],
    );
    return { ok: true };
  }

  private invoiceIdFromLink(link: string | null) {
    try { return link ? new URL(link, 'http://local').searchParams.get('invoice') : null; }
    catch { return null; }
  }

  // Existing notifications may predate completion tracking. Use recorded customer
  // actions, never read_at, to recover their state without marking new updates done.
  private async withActionHistory<T extends {
    orderId: string | null; invoiceId: string | null; title: string;
    createdAt: Date; completedAt: Date | null; completionLabel: string | null; requiresAction: boolean;
  }>(userId: string, items: T[]): Promise<T[]> {
    const pending = items.filter((n) => n.requiresAction && !n.completedAt);
    const orders = [...new Set(pending.map((n) => n.orderId).filter((id): id is string => Boolean(id)))];
    const invoiceIds = [...new Set(pending.map((n) => n.invoiceId).filter((id): id is string => Boolean(id)))];
    if (!orders.length && !invoiceIds.length) return items;
    const placeholders = orders.map(() => '?').join(',');
    type QuoteHistory = { id: string; approved_at: Date | null; status: string; updated_at: Date };
    type TimedOrderAction = { order_id: string; acted_at: Date };
    const [quotes, replies, downloads, invoices] = await Promise.all([
      orders.length ? this.db.query<QuoteHistory>(
        `SELECT id, approved_at, status, updated_at FROM orders WHERE client_user_id = ? AND id IN (${placeholders})`, [userId, ...orders],
      ) : Promise.resolve([] as QuoteHistory[]),
      orders.length ? this.db.query<TimedOrderAction>(
        `SELECT c.order_id, MAX(m.created_at) AS acted_at FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE m.sender_user_id = ? AND c.order_id IN (${placeholders}) GROUP BY c.order_id`, [userId, ...orders],
      ) : Promise.resolve([] as TimedOrderAction[]),
      orders.length ? this.db.query<TimedOrderAction>(
        `SELECT d.order_id, MAX(df.downloaded_at) AS acted_at FROM delivery_files df JOIN deliveries d ON d.id = df.delivery_id JOIN orders o ON o.id = d.order_id
          WHERE o.client_user_id = ? AND d.order_id IN (${placeholders}) AND df.downloaded_at IS NOT NULL GROUP BY d.order_id`, [userId, ...orders],
      ) : Promise.resolve([] as TimedOrderAction[]),
      this.db.query<{ id: string; order_id: string | null; status: string; paid_at: Date | null }>(
        `SELECT i.id, i.order_id, i.status, i.paid_at FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE c.user_id = ? AND
          (${orders.length ? `i.order_id IN (${placeholders})` : '1=0'} OR ${invoiceIds.length ? `i.id IN (${invoiceIds.map(() => '?').join(',')})` : '1=0'})`,
        [userId, ...orders, ...invoiceIds],
      ),
    ]);
    return items.map((n) => {
      if (n.completedAt || !n.requiresAction) return n;
      const type = activityType(n.title);
      let at: Date | null | undefined;
      let label: string | null = null;
      if (type === 'message') { at = replies.find((r) => r.order_id === n.orderId)?.acted_at; label = 'Replied'; }
      if (type === 'files' || type === 'revised-files') { at = downloads.find((r) => r.order_id === n.orderId)?.acted_at; label = 'Downloaded'; }
      if (type === 'quote-ready' || type === 'quote-updated') {
        const quote = quotes.find((r) => r.id === n.orderId);
        at = quote?.approved_at;
        label = 'Approved';
        if (quote?.status === 'CLIENT_REJECTED_QUOTATION') { at = quote.updated_at; label = 'Declined'; }
      }
      if (type === 'invoice') {
        const relevant = invoices.filter((i) => n.invoiceId ? i.id === n.invoiceId : i.order_id === n.orderId);
        if (relevant.length && relevant.every((i) => i.status === 'PAID' || i.status === 'CANCELLED')) {
          at = relevant.filter((i) => i.status === 'PAID' && i.paid_at).sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime())[0]?.paid_at;
          label = 'Paid';
        }
      }
      return at && new Date(at).getTime() >= new Date(n.createdAt).getTime() ? { ...n, completedAt: at, completionLabel: label } : n;
    });
  }

  // Resolve legacy UUID/reference/conversation links as well as current order links.
  async completeOrderActivity(userId: string, orderId: string, types: string[], label: string, before = new Date()) {
    const items = await this.db.query<NotificationRow>(
      'SELECT id, title, link FROM notifications WHERE user_id = ? AND completed_at IS NULL AND created_at <= ?',
      [userId, before],
    );
    const candidates = items.filter((n) => types.includes(activityType(n.title)));
    const meta = await this.orderMetaFor(candidates.map((n) => n.link));
    const ids = candidates.filter((n) => {
      const keys = parseActivityLink(n.link);
      return keys.orderIds.includes(orderId) ||
        keys.refs.some((ref) => meta.byRef.get(ref)?.orderId === orderId) ||
        (keys.conversationId && meta.byConversation.get(keys.conversationId)?.orderId === orderId);
    }).map((n) => n.id);
    await this.completeIds(userId, ids, label, before);
  }

  private async completeIds(userId: string, ids: string[], label: string, before: Date) {
    if (!ids.length) return;
    await this.db.execute(
      `UPDATE notifications SET completed_at = ?, completion_label = ?, read_at = COALESCE(read_at, ?)
        WHERE user_id = ? AND completed_at IS NULL AND created_at <= ? AND id IN (${ids.map(() => '?').join(',')})`,
      [before, label, before, userId, before, ...ids],
    );
    this.events.emitCreated(userId);
  }

  async completeConversationReply(userId: string, conversationId: string, before: Date) {
    const items = await this.db.query<NotificationRow>(
      'SELECT id, title, link FROM notifications WHERE user_id = ? AND completed_at IS NULL AND created_at <= ?',
      [userId, before],
    );
    const ids = items.filter((n) => activityType(n.title) === 'message' && parseActivityLink(n.link).conversationId === conversationId).map((n) => n.id);
    await this.completeIds(userId, ids, 'Replied', before);
  }

  async completeInvoicePayment(userId: string, invoiceId: string, orderId: string | null) {
    const before = new Date();
    const items = await this.db.query<NotificationRow>(
      'SELECT id, title, link FROM notifications WHERE user_id = ? AND completed_at IS NULL AND created_at <= ?',
      [userId, before],
    );
    const ids = items.filter((n) => activityType(n.title) === 'invoice' && this.invoiceIdFromLink(n.link) === invoiceId).map((n) => n.id);
    await this.completeIds(userId, ids, 'Paid', before);
    if (orderId) {
      const open = await this.db.queryOne<{ n: number }>(
        "SELECT COUNT(*) AS n FROM invoices WHERE order_id = ? AND status IN ('AWAITING', 'PARTIAL')",
        [orderId],
      );
      if (Number(open?.n ?? 0) === 0) await this.completeOrderActivity(userId, orderId, ['invoice'], 'Paid', before);
    }
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
    const invoiceIds = new Set<string>();
    for (const link of links) {
      const keys = parseActivityLink(link);
      keys.orderIds.forEach((id) => ids.add(id));
      keys.refs.forEach((ref) => refs.add(ref));
      if (keys.conversationId) convos.add(keys.conversationId);
      const invoiceId = this.invoiceIdFromLink(link);
      if (invoiceId && /^[0-9a-f-]{36}$/i.test(invoiceId)) invoiceIds.add(invoiceId);
    }
    const byId = new Map<string, OrderMeta>();
    const byRef = new Map<string, OrderMeta>();
    const byConversation = new Map<string, OrderMeta>();
    const byInvoice = new Map<string, OrderMeta>();
    if (invoiceIds.size) {
      const list = [...invoiceIds];
      const rows = await this.db.query<{ id: string; order_id: string | null; name: string | null; human_ref: string | null }>(
        `SELECT i.id, i.order_id, o.name, o.human_ref FROM invoices i LEFT JOIN orders o ON o.id = i.order_id WHERE i.id IN (${list.map(() => '?').join(',')})`, list,
      );
      for (const row of rows) byInvoice.set(row.id, { orderId: row.order_id, name: cleanDesign(row.name), humanRef: row.human_ref });
    }
    if (ids.size > 0) {
      const list = [...ids];
      const rows = await this.db.query<{ id: string; name: string | null; human_ref: string | null }>(
        `SELECT id, name, human_ref FROM orders WHERE id IN (${list.map(() => '?').join(',')})`,
        list,
      );
      for (const row of rows) {
        byId.set(row.id, { orderId: row.id, name: cleanDesign(row.name), humanRef: row.human_ref });
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
          byRef.set(row.human_ref, { orderId: row.id, name: cleanDesign(row.name), humanRef: row.human_ref });
        }
      }
    }
    if (convos.size > 0) {
      const list = [...convos];
      const rows = await this.db.query<{
        id: string;
        order_id: string | null;
        name: string | null;
        human_ref: string | null;
      }>(
        `SELECT c.id, c.order_id, o.name, o.human_ref
           FROM conversations c
           LEFT JOIN orders o ON o.id = c.order_id
          WHERE c.id IN (${list.map(() => '?').join(',')})`,
        list,
      );
      for (const row of rows) {
        byConversation.set(row.id, { orderId: row.order_id, name: cleanDesign(row.name), humanRef: row.human_ref });
      }
    }
    return { byId, byRef, byConversation, byInvoice };
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
    await this.completeOrderActivity(userId, orderId, ['files', 'revised-files'], 'Downloaded');
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
