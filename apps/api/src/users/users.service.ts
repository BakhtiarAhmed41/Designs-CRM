import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '../common/enums';
import { DbService } from '../db/db.service';

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: Date;
  updated_at: Date;
};

function toDto(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    firstName: u.first_name,
    lastName: u.last_name,
    phone: u.phone,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

@Injectable()
export class UsersService {
  constructor(private db: DbService) {}

  async getById(id: string) {
    const user = await this.db.queryOne<UserRow>(
      'SELECT id, email, role, first_name, last_name, phone, created_at, updated_at FROM users WHERE id = ? LIMIT 1',
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
