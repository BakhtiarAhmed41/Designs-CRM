import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { OrderStatus, Presence, UserRole } from '../common/enums';
import { DbService } from '../db/db.service';

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
  constructor(private db: DbService) {}

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

    const passwordHash = await argon2.hash(data.password);
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
      status: OrderStatus;
      price_cents: number | null;
      currency: string;
      due_date: Date | null;
      created_at: Date;
      customer_name: string | null;
    }>(
      `SELECT o.id, o.human_ref, o.name, o.status, o.price_cents, o.currency,
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
      status: o.status,
      priceCents: o.price_cents,
      currency: o.currency,
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
    await this.db.execute(
      'UPDATE orders SET assigned_designer_id = ? WHERE id = ?',
      [userId, orderId],
    );
    return { orderId, assignedDesignerId: userId };
  }

  async listStaffChat(meId: string, peerId: string) {
    const peer = await this.getStaffRow(peerId);
    if (!peer || peer.role === UserRole.CLIENT)
      throw new NotFoundException('Team member not found');
    const rows = await this.db.query<{
      id: string;
      from_user_id: string;
      to_user_id: string;
      body: string;
      created_at: Date;
    }>(
      `SELECT id, from_user_id, to_user_id, body, created_at
         FROM staff_messages
        WHERE (from_user_id = ? AND to_user_id = ?)
           OR (from_user_id = ? AND to_user_id = ?)
        ORDER BY created_at ASC
        LIMIT 200`,
      [meId, peerId, peerId, meId],
    );
    return {
      peer: this.staffDto(peer),
      messages: rows.map((m) => ({
        id: m.id,
        fromUserId: m.from_user_id,
        toUserId: m.to_user_id,
        body: m.body,
        createdAt: m.created_at,
        mine: m.from_user_id === meId,
      })),
    };
  }

  async sendStaffChat(meId: string, peerId: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Message required');
    const peer = await this.getStaffRow(peerId);
    if (!peer || peer.role === UserRole.CLIENT)
      throw new NotFoundException('Team member not found');
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO staff_messages (id, from_user_id, to_user_id, body)
       VALUES (?, ?, ?, ?)`,
      [id, meId, peerId, text],
    );
    return this.listStaffChat(meId, peerId);
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

  async listGroupChat() {
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
    return {
      messages: rows.map((m) => ({
        id: m.id,
        senderUserId: m.sender_user_id,
        body: m.body,
        createdAt: m.created_at,
        senderName:
          [m.first_name, m.last_name].filter(Boolean).join(' ') ||
          m.email.split('@')[0],
      })),
    };
  }

  async sendGroupChat(meId: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Message required');
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO staff_group_messages (id, sender_user_id, body) VALUES (?, ?, ?)`,
      [id, meId, text],
    );
    return this.listGroupChat();
  }
}
