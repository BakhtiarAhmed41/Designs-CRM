import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { UserRole } from '../common/enums';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { resolvePermissions } from '../auth/permissions';
import { LocalStorageService } from '../storage/local-storage.service';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

type UserRow = {
  id: string;
  email: string;
  pending_email?: string | null;
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
    pendingEmail: u.pending_email ?? null,
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
  constructor(
    private db: DbService,
    private mail: MailService,
    private storage: LocalStorageService,
  ) {}

  private async photoKey(id: string) {
    const user = await this.db.queryOne<{ profile_image_key: string | null }>(
      'SELECT profile_image_key FROM users WHERE id = ? LIMIT 1',
      [id],
    );
    if (!user) throw new NotFoundException('User not found');
    return user.profile_image_key;
  }

  async getProfilePhoto(id: string) {
    const key = await this.photoKey(id);
    return {
      url: key
        ? await this.storage.createSignedUrl({ key, inline: true })
        : null,
    };
  }

  async uploadProfilePhoto(id: string, file?: Express.Multer.File) {
    const body = file?.buffer;
    if (!body?.length) throw new BadRequestException('Choose a profile photo');
    if (body.length > 5 * 1024 * 1024)
      throw new BadRequestException('Use a photo smaller than 5 MB');
    const type = body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : body[0] === 255 && body[1] === 216 && body[2] === 255
        ? 'jpeg'
        : body.length >= 12 &&
            body.toString('ascii', 0, 4) === 'RIFF' &&
            body.toString('ascii', 8, 12) === 'WEBP'
          ? 'webp'
          : null;
    if (!type) throw new BadRequestException('Choose a PNG, JPG or WebP image');
    const previous = await this.photoKey(id);
    const key = this.storage.newObjectKey(
      ['users', id, 'profile'],
      `photo.${type}`,
    );
    await this.storage.uploadObject({
      key,
      body,
      contentType: `image/${type}`,
    });
    try {
      await this.db.execute(
        'UPDATE users SET profile_image_key = ? WHERE id = ?',
        [key, id],
      );
    } catch (error) {
      await this.storage.deleteObject(key).catch(() => undefined);
      throw error;
    }
    if (previous)
      await this.storage.deleteObject(previous).catch(() => undefined);
    return { url: await this.storage.createSignedUrl({ key, inline: true }) };
  }

  async removeProfilePhoto(id: string) {
    const previous = await this.photoKey(id);
    await this.db.execute(
      'UPDATE users SET profile_image_key = NULL WHERE id = ?',
      [id],
    );
    if (previous)
      await this.storage.deleteObject(previous).catch(() => undefined);
    return { url: null };
  }

  async getById(id: string) {
    const user = await this.db.queryOne<UserRow>(
      `SELECT u.id, u.email, u.pending_email, u.role, u.login_status, u.custom_role_id, u.permissions,
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

  async requestEmailChange(id: string, nextEmail: string) {
    const email = nextEmail.trim().toLowerCase();
    if (!email.includes('@'))
      throw new BadRequestException('Enter a valid email');
    const current = await this.db.queryOne<{ email: string }>(
      'SELECT email FROM users WHERE id = ? LIMIT 1',
      [id],
    );
    if (!current) throw new NotFoundException('User not found');
    if (current.email === email) {
      throw new BadRequestException('That is already your email');
    }
    const taken = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
      [email, id],
    );
    if (taken) throw new ConflictException('That email is already in use');
    await this.db.execute('UPDATE users SET pending_email = ? WHERE id = ?', [
      email,
      id,
    ]);
    const token = randomBytes(32).toString('hex');
    await this.db.execute(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [
        randomUUID(),
        id,
        hashToken(`email-change:${token}`),
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      ],
    );
    const emailed = await this.mail.sendEmailChangeConfirm(email, token);
    return { ok: true, emailSent: emailed, pendingEmail: email };
  }
}
