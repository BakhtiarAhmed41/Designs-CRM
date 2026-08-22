import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { hashSecret } from '../auth/password';
import { OrderStatus, Presence, UserRole } from '../common/enums';
import { DbService } from '../db/db.service';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { LocalStorageService } from '../storage/local-storage.service';

export type UploadFile = {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
};

type StaffRow = {
  id: string;
  email: string;
  role: UserRole;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  initials: string | null;
  presence: Presence;
  skills: unknown;
  permissions: unknown;
  created_at: Date;
  updated_at: Date;
};

const ACTIVE_STATUSES = [
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY_TO_SEND,
  OrderStatus.REVISION_REQUESTED,
];

const STAFF_ONLY_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
  UserRole.DESIGNER,
];

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

@Injectable()
export class TeamService {
  constructor(
    private db: DbService,
    private storage: LocalStorageService,
    private notifications: NotificationsService,
    @Optional()
    @Inject(forwardRef(() => MessagingGateway))
    private gateway?: MessagingGateway,
  ) {}

  private staffDto(u: StaffRow, workload = 0) {
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
      initials: u.initials,
      presence: u.presence,
      skills: parseJson<string[]>(u.skills, []),
      permissions: parseJson<Record<string, boolean>>(u.permissions, {}),
      workload,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  }

  private computeInitials(email: string, firstName?: string | null): string {
    if (firstName && firstName.trim().length >= 2)
      return firstName.trim().slice(0, 2).toUpperCase();
    return email.slice(0, 2).toUpperCase();
  }

  async list() {
    const rows = await this.db.query<StaffRow & { workload: number | string }>(
      `SELECT u.*,
         (SELECT COUNT(*) FROM orders o
            WHERE o.assigned_designer_id = u.id
              AND o.status IN (?, ?, ?)) AS workload
       FROM users u
       WHERE u.role <> 'CLIENT'
       ORDER BY u.role ASC, u.first_name ASC, u.email ASC`,
      ACTIVE_STATUSES,
    );
    return rows.map((r) => this.staffDto(r, Number(r.workload ?? 0)));
  }

  private async getStaffRow(id: string): Promise<StaffRow | null> {
    return this.db.queryOne<StaffRow>(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [id],
    );
  }

  async create(data: {
    email: string;
    password: string;
    role: UserRole;
    firstName?: string | null;
    skills?: string[];
  }) {
    if (!STAFF_ONLY_ROLES.includes(data.role))
      throw new BadRequestException('Role must be a staff role');

    const email = data.email.toLowerCase();
    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await hashSecret(data.password);
    const id = this.db.uuid();
    const initials = this.computeInitials(email, data.firstName);
    await this.db.execute(
      `INSERT INTO users
         (id, email, password_hash, role, first_name, initials, presence, skills)
       VALUES (?, ?, ?, ?, ?, ?, 'OFF', ?)`,
      [
        id,
        email,
        passwordHash,
        data.role,
        data.firstName || null,
        initials,
        JSON.stringify(data.skills ?? []),
      ],
    );

    const row = await this.getStaffRow(id);
    return this.staffDto(row!, 0);
  }

  async update(
    id: string,
    data: {
      role?: UserRole;
      firstName?: string | null;
      lastName?: string | null;
      skills?: string[];
      permissions?: Record<string, boolean>;
      presence?: Presence;
    },
  ) {
    const existing = await this.getStaffRow(id);
    if (!existing || existing.role === UserRole.CLIENT)
      throw new NotFoundException('Team member not found');

    if (data.role !== undefined) {
      if (!STAFF_ONLY_ROLES.includes(data.role))
        throw new BadRequestException('Role must be a staff role');
      // Prevent demoting the last SUPER_ADMIN (best-effort).
      if (
        existing.role === UserRole.SUPER_ADMIN &&
        data.role !== UserRole.SUPER_ADMIN
      ) {
        const count = await this.db.queryOne<{ cnt: number | string }>(
          "SELECT COUNT(*) AS cnt FROM users WHERE role = 'SUPER_ADMIN'",
        );
        if (Number(count?.cnt ?? 0) <= 1)
          throw new BadRequestException('Cannot demote the last super admin');
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.role !== undefined) {
      sets.push('role = ?');
      params.push(data.role);
    }
    if (data.firstName !== undefined) {
      sets.push('first_name = ?');
      params.push(data.firstName || null);
    }
    if (data.lastName !== undefined) {
      sets.push('last_name = ?');
      params.push(data.lastName || null);
    }
    if (data.skills !== undefined) {
      sets.push('skills = ?');
      params.push(JSON.stringify(data.skills));
    }
    if (data.permissions !== undefined) {
      sets.push('permissions = ?');
      params.push(JSON.stringify(data.permissions));
    }
    if (data.presence !== undefined) {
      sets.push('presence = ?');
      params.push(data.presence);
    }
    if (sets.length > 0) {
      params.push(id);
      await this.db.execute(
        `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }

    const row = await this.getStaffRow(id);
    const workload = await this.workloadFor(id);
    return this.staffDto(row!, workload);
  }

  async setPresence(userId: string, presence: Presence) {
    const existing = await this.getStaffRow(userId);
    if (!existing) throw new NotFoundException('User not found');
    await this.db.execute('UPDATE users SET presence = ? WHERE id = ?', [
      presence,
      userId,
    ]);
    const row = await this.getStaffRow(userId);
    const workload = await this.workloadFor(userId);
    return this.staffDto(row!, workload);
  }

  private async workloadFor(userId: string): Promise<number> {
    const row = await this.db.queryOne<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM orders
         WHERE assigned_designer_id = ? AND status IN (?, ?, ?)`,
      [userId, ...ACTIVE_STATUSES],
    );
    return Number(row?.cnt ?? 0);
  }

  async myWork(userId: string) {
    const rows = await this.db.query<{
      id: string;
      human_ref: string | null;
      name: string | null;
      service_type: string | null;
      status: OrderStatus;
      price_cents: number | null;
      currency: string;
      due_date: Date | null;
      created_at: Date;
      customer_name: string | null;
    }>(
      `SELECT o.id, o.human_ref, o.name, o.service_type, o.status, o.price_cents, o.currency,
              o.due_date, o.created_at, c.name AS customer_name
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.assigned_designer_id = ? AND o.status IN (?, ?, ?)
        ORDER BY (o.due_date IS NULL), o.due_date ASC, o.created_at ASC`,
      [userId, ...ACTIVE_STATUSES],
    );
    return rows.map((o) => ({
      id: o.id,
      humanRef: o.human_ref,
      name: o.name,
      serviceType: o.service_type,
      status: o.status,
      dueDate: o.due_date,
      createdAt: o.created_at,
      customerName: o.customer_name,
    }));
  }

  async assignOrder(userId: string, orderId: string) {
    const staff = await this.getStaffRow(userId);
    if (!staff || staff.role === UserRole.CLIENT)
      throw new NotFoundException('Team member not found');
    const order = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM orders WHERE id = ? LIMIT 1',
      [orderId],
    );
    if (!order) throw new NotFoundException('Order not found');
    const current = await this.db.queryOne<{ status: string; type: string }>(
      'SELECT status, type FROM orders WHERE id = ? LIMIT 1',
      [orderId],
    );
    const startWork =
      current?.type === 'ORDER' &&
      (current.status === 'PENDING_PAYMENT' || current.status === 'CREATED');
    await this.db.execute(
      startWork
        ? 'UPDATE orders SET assigned_designer_id = ?, status = ? WHERE id = ?'
        : 'UPDATE orders SET assigned_designer_id = ? WHERE id = ?',
      startWork
        ? [userId, OrderStatus.IN_PROGRESS, orderId]
        : [userId, orderId],
    );
    return { orderId, assignedDesignerId: userId, status: startWork ? OrderStatus.IN_PROGRESS : current?.status };
  }

  private async staffAttachments(messageIds: string[], channel: 'DM' | 'GROUP') {
    if (messageIds.length === 0) return new Map<string, Array<{
      id: string;
      originalName: string;
      mimeType: string | null;
      byteSize: number | null;
      url: string;
    }>>();
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = await this.db.query<{
      id: string;
      message_id: string;
      original_name: string;
      mime_type: string | null;
      byte_size: number | null;
      storage_key: string;
    }>(
      `SELECT id, message_id, original_name, mime_type, byte_size, storage_key
         FROM staff_message_attachments
        WHERE channel = ? AND message_id IN (${placeholders})`,
      [channel, ...messageIds],
    );
    const map = new Map<
      string,
      Array<{
        id: string;
        originalName: string;
        mimeType: string | null;
        byteSize: number | null;
        url: string;
      }>
    >();
    for (const row of rows) {
      const url = await this.storage.createSignedUrl({
        key: row.storage_key,
        downloadAs: row.original_name,
      });
      const list = map.get(row.message_id) ?? [];
      list.push({
        id: row.id,
        originalName: row.original_name,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        url,
      });
      map.set(row.message_id, list);
    }
    return map;
  }

  private async saveStaffAttachments(
    messageId: string,
    channel: 'DM' | 'GROUP',
    files: UploadFile[],
  ) {
    const out = [];
    for (const file of files) {
      const key = this.storage.newObjectKey(
        ['team-chat', channel.toLowerCase(), messageId],
        file.originalname,
      );
      await this.storage.uploadObject({
        key,
        body: file.buffer,
        contentType: file.mimetype,
      });
      const id = randomUUID();
      await this.db.execute(
        `INSERT INTO staff_message_attachments
           (id, message_id, channel, original_name, mime_type, byte_size, storage_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          messageId,
          channel,
          file.originalname.slice(0, 255),
          file.mimetype ?? null,
          file.size,
          key,
        ],
      );
      const url = await this.storage.createSignedUrl({
        key,
        downloadAs: file.originalname,
      });
      out.push({
        id,
        originalName: file.originalname,
        mimeType: file.mimetype ?? null,
        byteSize: file.size,
        url,
      });
    }
    return out;
  }

  async listStaffChat(meId: string, peerId: string) {
    const peer = await this.getStaffRow(peerId);
    if (!peer || peer.role === UserRole.CLIENT)
      throw new NotFoundException('Team member not found');
    await this.markStaffChatRead(meId, peerId);
    const rows = await this.db.query<{
      id: string;
      from_user_id: string;
      to_user_id: string;
      body: string;
      read_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, from_user_id, to_user_id, body, read_at, created_at
         FROM staff_messages
        WHERE (from_user_id = ? AND to_user_id = ?)
           OR (from_user_id = ? AND to_user_id = ?)
        ORDER BY created_at ASC
        LIMIT 200`,
      [meId, peerId, peerId, meId],
    );
    const attMap = await this.staffAttachments(
      rows.map((r) => r.id),
      'DM',
    );
    return {
      peer: this.staffDto(peer),
      messages: rows.map((m) => ({
        id: m.id,
        fromUserId: m.from_user_id,
        toUserId: m.to_user_id,
        body: m.body,
        readAt: m.read_at,
        createdAt: m.created_at,
        mine: m.from_user_id === meId,
        attachments: attMap.get(m.id) ?? [],
      })),
    };
  }

  async markStaffChatRead(meId: string, peerId: string) {
    await this.db.execute(
      `UPDATE staff_messages
          SET read_at = NOW()
        WHERE to_user_id = ? AND from_user_id = ? AND read_at IS NULL`,
      [meId, peerId],
    );
    this.gateway?.emitToUser(meId, 'unread:changed', { scope: 'team' });
    return { ok: true };
  }

  async sendStaffChat(
    meId: string,
    peerId: string,
    body: string,
    files: UploadFile[] = [],
  ) {
    const text = body.trim();
    if (!text && files.length === 0)
      throw new BadRequestException('Message or attachment required');
    const peer = await this.getStaffRow(peerId);
    if (!peer || peer.role === UserRole.CLIENT)
      throw new NotFoundException('Team member not found');
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO staff_messages (id, from_user_id, to_user_id, body)
       VALUES (?, ?, ?, ?)`,
      [id, meId, peerId, text || '(attachment)'],
    );
    await this.saveStaffAttachments(id, 'DM', files);
    await this.notifications.createFor(peerId, {
      title: 'New team message',
      body: (text || 'Sent an attachment').slice(0, 140),
      link: `/admin/messages/team?peer=${meId}`,
    });
    const payload = await this.listStaffChat(meId, peerId);
    this.gateway?.emitTeamDm(meId, peerId, 'team:message', {
      peerId: meId,
      channel: 'dm',
    });
    this.gateway?.emitToUser(peerId, 'unread:changed', { scope: 'team' });
    return payload;
  }

  /** Prefer first SUPER_ADMIN / ADMIN as "owner" for designer/support chat. */
  async resolveOwnerId(): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM users
        WHERE role IN ('SUPER_ADMIN','ADMIN')
        ORDER BY FIELD(role,'SUPER_ADMIN','ADMIN'), created_at ASC
        LIMIT 1`,
    );
    return row?.id ?? null;
  }

  async listGroupChat(meId?: string) {
    if (meId) await this.markGroupChatRead(meId);
    const rows = await this.db.query<{
      id: string;
      sender_user_id: string;
      body: string;
      created_at: Date;
      first_name: string | null;
      last_name: string | null;
      email: string;
    }>(
      `SELECT m.id, m.sender_user_id, m.body, m.created_at,
              u.first_name, u.last_name, u.email
         FROM staff_group_messages m
         JOIN users u ON u.id = m.sender_user_id
        ORDER BY m.created_at ASC
        LIMIT 300`,
    );
    const attMap = await this.staffAttachments(
      rows.map((r) => r.id),
      'GROUP',
    );
    return {
      messages: rows.map((m) => ({
        id: m.id,
        senderUserId: m.sender_user_id,
        body: m.body,
        createdAt: m.created_at,
        senderName:
          [m.first_name, m.last_name].filter(Boolean).join(' ') ||
          m.email.split('@')[0],
        attachments: attMap.get(m.id) ?? [],
      })),
    };
  }

  async markGroupChatRead(meId: string) {
    await this.db.execute(
      `INSERT INTO staff_group_reads (user_id, last_read_at)
       VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE last_read_at = NOW()`,
      [meId],
    );
    this.gateway?.emitToUser(meId, 'unread:changed', { scope: 'team' });
    return { ok: true };
  }

  async sendGroupChat(meId: string, body: string, files: UploadFile[] = []) {
    const text = body.trim();
    if (!text && files.length === 0)
      throw new BadRequestException('Message or attachment required');
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO staff_group_messages (id, sender_user_id, body) VALUES (?, ?, ?)`,
      [id, meId, text || '(attachment)'],
    );
    await this.saveStaffAttachments(id, 'GROUP', files);

    const staff = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE role <> 'CLIENT' AND id <> ?`,
      [meId],
    );
    await this.notifications.createForMany(
      staff.map((s) => s.id),
      {
        title: 'New group chat message',
        body: (text || 'Sent an attachment').slice(0, 140),
        link: '/admin/messages/team?group=1',
      },
    );

    const payload = await this.listGroupChat(meId);
    this.gateway?.emitTeamGroup('team:message', { channel: 'group' });
    this.gateway?.server?.emit('unread:changed', { scope: 'team' });
    return payload;
  }

  async teamUnreadSummary(meId: string) {
    const dm = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM staff_messages
        WHERE to_user_id = ? AND read_at IS NULL`,
      [meId],
    );
    const group = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total
         FROM staff_group_messages m
         LEFT JOIN staff_group_reads r ON r.user_id = ?
        WHERE m.sender_user_id <> ?
          AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)`,
      [meId, meId],
    );
    const peers = await this.db.query<{ peer_id: string; unread: number }>(
      `SELECT from_user_id AS peer_id, COUNT(*) AS unread
         FROM staff_messages
        WHERE to_user_id = ? AND read_at IS NULL
        GROUP BY from_user_id`,
      [meId],
    );
    return {
      dmUnread: Number(dm?.total ?? 0),
      groupUnread: Number(group?.total ?? 0),
      peerUnread: Object.fromEntries(
        peers.map((p) => [p.peer_id, Number(p.unread)]),
      ),
    };
  }

  async recentTeamConversations(meId: string) {
    const rows = await this.db.query<{
      peer_id: string;
      last_at: Date;
      last_body: string;
      unread: number;
    }>(
      `SELECT peer_id, MAX(created_at) AS last_at,
              SUBSTRING_INDEX(GROUP_CONCAT(body ORDER BY created_at DESC SEPARATOR '\n'), '\n', 1) AS last_body,
              SUM(CASE WHEN to_user_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
         FROM (
           SELECT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END AS peer_id,
                  from_user_id, to_user_id, body, read_at, created_at
             FROM staff_messages
            WHERE from_user_id = ? OR to_user_id = ?
         ) t
        GROUP BY peer_id
        ORDER BY last_at DESC
        LIMIT 50`,
      [meId, meId, meId, meId],
    );
    return {
      conversations: rows.map((r) => ({
        peerId: r.peer_id,
        lastAt: r.last_at,
        lastBody: r.last_body,
        unread: Number(r.unread),
      })),
    };
  }
}
