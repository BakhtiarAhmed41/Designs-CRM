import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '../common/enums';
import { DbService } from '../db/db.service';
import { resolvePermissions } from '../auth/permissions';

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  login_status: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  custom_role_id: string | null;
  permissions: unknown;
  cr_permissions: unknown | null;
  created_at: Date;
  updated_at: Date;
};

function toDto(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    loginStatus: u.login_status,
    firstName: u.first_name,
    lastName: u.last_name,
    phone: u.phone,
    customRoleId: u.custom_role_id,
    permissions: resolvePermissions({
      role: u.role,
      userPermissions: u.permissions,
      customRolePermissions: u.cr_permissions,
    }),
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

@Injectable()
export class UsersService {
  constructor(private db: DbService) {}

  async getById(id: string) {
    const user = await this.db.queryOne<UserRow>(
      `SELECT u.id, u.email, u.role, u.login_status, u.custom_role_id, u.permissions,
              u.first_name, u.last_name, u.phone, u.created_at, u.updated_at,
              r.permissions AS cr_permissions
         FROM users u
         LEFT JOIN custom_roles r ON r.id = u.custom_role_id
        WHERE u.id = ?
        LIMIT 1`,
      [id],
    );
    if (!user) throw new NotFoundException('User not found');
    return toDto(user);
  }

  async updateProfile(
    id: string,
    data: {
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
    },
  ) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.firstName !== undefined) {
      sets.push('first_name = ?');
      params.push(data.firstName);
    }
    if (data.lastName !== undefined) {
      sets.push('last_name = ?');
      params.push(data.lastName);
    }
    if (data.phone !== undefined) {
      sets.push('phone = ?');
      params.push(data.phone);
    }
    if (sets.length > 0) {
      params.push(id);
      await this.db.execute(
        `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    return this.getById(id);
  }
}
