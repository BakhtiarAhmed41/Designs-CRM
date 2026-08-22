import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hashSecret } from '../auth/password';
import {
  FEATURE_KEYS,
  LoginStatus,
  UserRole,
  type FeatureKey,
} from '../common/enums';
import { DbService } from '../db/db.service';
import { normalizePage, pageResult } from '../common/pagination';

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  base_role: 'ADMIN' | 'SUPPORT' | 'DESIGNER';
  permissions: unknown;
  created_at: Date;
  updated_at: Date;
};

type StaffUserRow = {
  id: string;
  email: string;
  role: UserRole;
  login_status: LoginStatus;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  custom_role_id: string | null;
  presence: string;
  created_at: Date;
  role_name: string | null;
};

function parsePermissions(value: unknown): Record<FeatureKey, boolean> {
  const base = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<
    FeatureKey,
    boolean
  >;
  let obj: Record<string, unknown> = {};
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (value && typeof value === 'object') {
    obj = value as Record<string, unknown>;
  }
  for (const key of FEATURE_KEYS) {
    base[key] = Boolean(obj[key]);
  }
  return base;
}

@Injectable()
export class RolesService {
  constructor(private db: DbService) {}

  private roleDto(r: RoleRow) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      baseRole: r.base_role,
      permissions: parsePermissions(r.permissions),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async listRoles() {
    const rows = await this.db.query<RoleRow>(
      'SELECT * FROM custom_roles ORDER BY name ASC',
    );
    return rows.map((r) => this.roleDto(r));
  }

  async createRole(data: {
    name: string;
    description?: string | null;
    baseRole: 'ADMIN' | 'SUPPORT' | 'DESIGNER';
    permissions?: Partial<Record<FeatureKey, boolean>>;
  }) {
    const name = data.name.trim();
    if (!name) throw new BadRequestException('Role name is required');
    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM custom_roles WHERE name = ? LIMIT 1',
      [name],
    );
    if (existing) throw new ConflictException('Role name already exists');

    const permissions = parsePermissions(data.permissions);
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO custom_roles (id, name, description, base_role, permissions)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        name,
        data.description?.trim() || null,
        data.baseRole,
        JSON.stringify(permissions),
      ],
    );
    const row = await this.db.queryOne<RoleRow>(
      'SELECT * FROM custom_roles WHERE id = ? LIMIT 1',
      [id],
    );
    return this.roleDto(row!);
  }

  async updateRole(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      baseRole?: 'ADMIN' | 'SUPPORT' | 'DESIGNER';
      permissions?: Partial<Record<FeatureKey, boolean>>;
    },
  ) {
    const existing = await this.db.queryOne<RoleRow>(
      'SELECT * FROM custom_roles WHERE id = ? LIMIT 1',
      [id],
    );
    if (!existing) throw new NotFoundException('Role not found');

    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.name !== undefined) {
      sets.push('name = ?');
      params.push(data.name.trim());
    }
    if (data.description !== undefined) {
      sets.push('description = ?');
      params.push(data.description?.trim() || null);
    }
    if (data.baseRole !== undefined) {
      sets.push('base_role = ?');
      params.push(data.baseRole);
    }
    if (data.permissions !== undefined) {
      sets.push('permissions = ?');
      params.push(JSON.stringify(parsePermissions(data.permissions)));
    }
    if (sets.length) {
      params.push(id);
      await this.db.execute(
        `UPDATE custom_roles SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }

    // Sync system role for assigned users when base role changes.
    if (data.baseRole) {
      await this.db.execute(
        'UPDATE users SET role = ? WHERE custom_role_id = ? AND role <> ?',
        [data.baseRole, id, UserRole.SUPER_ADMIN],
      );
    }

    const row = await this.db.queryOne<RoleRow>(
      'SELECT * FROM custom_roles WHERE id = ? LIMIT 1',
      [id],
    );
    return this.roleDto(row!);
  }

  async deleteRole(id: string) {
    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM custom_roles WHERE id = ? LIMIT 1',
      [id],
    );
    if (!existing) throw new NotFoundException('Role not found');
    await this.db.execute(
      'UPDATE users SET custom_role_id = NULL WHERE custom_role_id = ?',
      [id],
    );
    await this.db.execute('DELETE FROM custom_roles WHERE id = ?', [id]);
    return { ok: true };
  }

  async listUsers(filters: {
    q?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { page, pageSize, offset } = normalizePage(filters);
    const where = [`u.role <> 'CLIENT'`];
    const params: unknown[] = [];
    if (filters.q) {
      where.push(
        `(u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR r.name LIKE ?)`,
      );
      const like = `%${filters.q}%`;
      params.push(like, like, like, like);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const count = await this.db.queryOne<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM users u
       LEFT JOIN custom_roles r ON r.id = u.custom_role_id
       ${whereSql}`,
      params,
    );
    const rows = await this.db.query<StaffUserRow>(
      `SELECT u.id, u.email, u.role, u.login_status, u.first_name, u.last_name, u.phone,
              u.custom_role_id, u.presence, u.created_at, r.name AS role_name
         FROM users u
         LEFT JOIN custom_roles r ON r.id = u.custom_role_id
         ${whereSql}
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    return pageResult(
      rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        loginStatus: u.login_status,
        firstName: u.first_name,
        lastName: u.last_name,
        phone: u.phone,
        customRoleId: u.custom_role_id,
        customRoleName: u.role_name,
        presence: u.presence,
        canLogin: u.login_status === LoginStatus.ACTIVE,
        createdAt: u.created_at,
      })),
      Number(count?.n ?? 0),
      page,
      pageSize,
    );
  }

  async createUser(data: {
    email: string;
    password: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    role?: UserRole;
    customRoleId?: string | null;
    loginStatus?: LoginStatus;
  }) {
    if (data.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const email = data.email.toLowerCase();
    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (existing) throw new ConflictException('Email already exists');

    let role: UserRole = data.role ?? UserRole.SUPPORT;
    let customRoleId = data.customRoleId ?? null;
    if (customRoleId) {
      const cr = await this.db.queryOne<RoleRow>(
        'SELECT * FROM custom_roles WHERE id = ? LIMIT 1',
        [customRoleId],
      );
      if (!cr) throw new BadRequestException('Custom role not found');
      role = cr.base_role;
    }
    if (role === UserRole.CLIENT) {
      throw new BadRequestException('Use customer screens to create clients');
    }

    const id = randomUUID();
    const passwordHash = await hashSecret(data.password);
    const initials = (
      data.firstName?.slice(0, 2) ||
      email.slice(0, 2)
    ).toUpperCase();
    await this.db.execute(
      `INSERT INTO users
         (id, email, password_hash, role, login_status, custom_role_id, first_name, last_name, phone, initials, presence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFF')`,
      [
        id,
        email,
        passwordHash,
        role,
        data.loginStatus ?? LoginStatus.ACTIVE,
        customRoleId,
        data.firstName?.trim() || null,
        data.lastName?.trim() || null,
        data.phone?.trim() || null,
        initials,
      ],
    );
    const page = await this.listUsers({ q: email, page: 1, pageSize: 1 });
    return page.items[0];
  }

  async updateUser(
    id: string,
    data: {
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      role?: UserRole;
      customRoleId?: string | null;
      loginStatus?: LoginStatus;
      password?: string;
    },
  ) {
    const existing = await this.db.queryOne<{ id: string; role: UserRole }>(
      'SELECT id, role FROM users WHERE id = ? LIMIT 1',
      [id],
    );
    if (!existing || existing.role === UserRole.CLIENT) {
      throw new NotFoundException('User not found');
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.customRoleId !== undefined) {
      if (data.customRoleId) {
        const cr = await this.db.queryOne<RoleRow>(
          'SELECT * FROM custom_roles WHERE id = ? LIMIT 1',
          [data.customRoleId],
        );
        if (!cr) throw new BadRequestException('Custom role not found');
        sets.push('custom_role_id = ?', 'role = ?');
        params.push(data.customRoleId, cr.base_role);
      } else {
        sets.push('custom_role_id = ?');
        params.push(null);
      }
    }
    // System role applies when not assigning a custom role in this update.
    if (data.role !== undefined && !data.customRoleId) {
      if (data.role === UserRole.CLIENT) {
        throw new BadRequestException('Cannot set staff user to CLIENT');
      }
      sets.push('role = ?');
      params.push(data.role);
    }
    if (data.firstName !== undefined) {
      sets.push('first_name = ?');
      params.push(data.firstName?.trim() || null);
    }
    if (data.lastName !== undefined) {
      sets.push('last_name = ?');
      params.push(data.lastName?.trim() || null);
    }
    if (data.phone !== undefined) {
      sets.push('phone = ?');
      params.push(data.phone?.trim() || null);
    }
    if (data.loginStatus !== undefined) {
      sets.push('login_status = ?');
      params.push(data.loginStatus);
    }
    if (data.password) {
      if (data.password.length < 6) {
        throw new BadRequestException('Password must be at least 6 characters');
      }
      sets.push('password_hash = ?');
      params.push(await hashSecret(data.password));
    }
    if (sets.length) {
      params.push(id);
      await this.db.execute(
        `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    const page = await this.listUsers({ page: 1, pageSize: 200 });
    const user = page.items.find((u) => u.id === id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  featureCatalog() {
    const labels: Record<FeatureKey, string> = {
      dashboard: 'Dashboard',
      messages: 'Messages (umbrella)',
      messages_customer_view: 'View customer messages',
      messages_customer_reply: 'Reply to customer messages',
      messages_customer_start: 'Start customer chats',
      messages_team_view: 'View team messages',
      messages_team_send: 'Send team messages',
      messages_group: 'Access group chat',
      messages_delete: 'Delete messages',
      orders: 'Orders',
      quotes: 'Quotes',
      edits: 'Edits',
      customers: 'Customers',
      billing: 'Billing',
      team: 'Team',
      roles: 'Roles & users',
    };
    return FEATURE_KEYS.map((key) => ({ key, label: labels[key] }));
  }
}
