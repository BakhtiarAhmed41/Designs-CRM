import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AccountType, CustomerSource, LoginStatus, UserRole } from '../common/enums';
import { getEnv } from '../config/env';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolvePermissions } from './permissions';

type Tokens = {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  login_status: LoginStatus;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  custom_role_id: string | null;
  permissions: unknown;
  cr_permissions?: unknown | null;
};

function publicUser(u: UserRow) {
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
      customRolePermissions: u.cr_permissions ?? null,
    }),
  };
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private db: DbService,
    private jwt: JwtService,
    private notifications: NotificationsService,
    private mail: MailService,
  ) {}

  private async findByEmail(email: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.role, u.login_status, u.first_name, u.last_name,
              u.phone, u.custom_role_id, u.permissions, r.permissions AS cr_permissions
         FROM users u
         LEFT JOIN custom_roles r ON r.id = u.custom_role_id
        WHERE u.email = ?
        LIMIT 1`,
      [email.toLowerCase()],
    );
  }

  private async findById(id: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.role, u.login_status, u.first_name, u.last_name,
              u.phone, u.custom_role_id, u.permissions, r.permissions AS cr_permissions
         FROM users u
         LEFT JOIN custom_roles r ON r.id = u.custom_role_id
        WHERE u.id = ?
        LIMIT 1`,
      [id],
    );
  }

  async registerClient(params: {
    email: string;
    password: string;
    name: string;
    phone?: string | null;
  }) {
    const email = params.email.toLowerCase();
    const name = params.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    if (params.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existing = await this.findByEmail(email);
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await argon2.hash(params.password);
    const id = randomUUID();
    const initials = name.slice(0, 2).toUpperCase() || email.slice(0, 2).toUpperCase();
    const phone = params.phone?.trim() || null;
    const nameParts = name.split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    await this.db.withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO users
           (id, email, password_hash, role, login_status, first_name, last_name, phone, initials, presence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFF')`,
        [
          id,
          email,
          passwordHash,
          UserRole.CLIENT,
          LoginStatus.PENDING,
          firstName,
          lastName,
          phone,
          initials,
        ],
      );
      await tx.execute(
        `INSERT INTO customers
           (id, user_id, name, email, phone, account_type, source, since_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`,
        [
          randomUUID(),
          id,
          name,
          email,
          phone,
          AccountType.PAY_PER_ORDER,
          CustomerSource.PORTAL,
        ],
      );
    });

    const verifyToken = randomBytes(32).toString('hex');
    await this.db.execute(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [
        randomUUID(),
        id,
        hashToken(`verify:${verifyToken}`),
        new Date(Date.now() + 48 * 60 * 60 * 1000),
      ],
    );
    const mailed = await this.mail.sendEmailVerification(email, verifyToken);
    const env = getEnv();

    return {
      user: {
        id,
        email,
        role: UserRole.CLIENT,
        loginStatus: LoginStatus.PENDING,
        firstName,
        lastName,
        phone,
        customRoleId: null,
        permissions: resolvePermissions({
          role: UserRole.CLIENT,
          userPermissions: null,
          customRolePermissions: null,
        }),
      },
      pending: true as const,
      emailSent: mailed,
      verifyToken: env.NODE_ENV === 'production' ? null : verifyToken,
    };
  }

  async validateUser(email: string, password: string): Promise<UserRow> {
    const user = await this.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.login_status === LoginStatus.PENDING) {
      throw new UnauthorizedException(
        'Your account verification is in progress. Please wait for admin approval.',
      );
    }
    if (user.login_status === LoginStatus.DISABLED) {
      throw new UnauthorizedException(
        'Your account has been disabled. Contact support for help.',
      );
    }
    return user;
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    role: UserRole;
  }): Promise<Tokens> {
    const env = getEnv();
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const refreshTokenHash = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);
    const id = randomUUID();

    await this.db.execute(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [id, user.id, refreshTokenHash, expiresAt],
    );

    return { accessToken, refreshToken, refreshTokenId: id };
  }

  async login(params: { email: string; password: string }) {
    const user = await this.validateUser(params.email, params.password);
    const tokens = await this.issueTokens(user);
    return { user: publicUser(user), tokens };
  }

  async refresh(params: { refreshToken: string; refreshTokenId: string }) {
    const rt = await this.db.queryOne<{
      id: string;
      token_hash: string;
      user_id: string;
    }>(
      'SELECT id, token_hash, user_id FROM refresh_tokens WHERE id = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1',
      [params.refreshTokenId],
    );
    if (!rt) throw new UnauthorizedException('Invalid refresh token');

    const ok = await argon2.verify(rt.token_hash, params.refreshToken);
    if (!ok) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.findById(rt.user_id);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    if (user.login_status !== LoginStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    const next = await this.issueTokens(user);
    await this.db.execute(
      'UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_id = ? WHERE id = ?',
      [next.refreshTokenId, rt.id],
    );

    return next;
  }

  async logout(params: { refreshToken?: string; refreshTokenId?: string }) {
    if (!params.refreshToken || !params.refreshTokenId) return;
    const rt = await this.db.queryOne<{ id: string; token_hash: string }>(
      'SELECT id, token_hash FROM refresh_tokens WHERE id = ? AND revoked_at IS NULL LIMIT 1',
      [params.refreshTokenId],
    );
    if (!rt) return;
    const ok = await argon2.verify(rt.token_hash, params.refreshToken);
    if (!ok) return;
    await this.db.execute(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?',
      [rt.id],
    );
  }

  async requestPasswordReset(email: string) {
    const user = await this.findByEmail(email);
    // Always succeed to avoid email enumeration.
    if (!user || user.login_status === LoginStatus.DISABLED) {
      return { ok: true, resetToken: null as string | null, emailSent: false };
    }
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.db.execute(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [id, user.id, hashToken(token), expiresAt],
    );
    const emailSent = await this.mail.sendPasswordReset(user.email, token);
    const env = getEnv();
    // Only expose the raw token when explicitly opted in (local tooling).
    // Never return it just because SMTP is off — that enables account takeover.
    const resetToken =
      !emailSent && env.AUTH_EXPOSE_RESET_TOKEN ? token : null;
    return { ok: true, resetToken, emailSent };
  }

  async verifyEmail(token: string) {
    if (!token?.trim()) throw new BadRequestException('Verification token is required');
    const row = await this.db.queryOne<{
      id: string;
      user_id: string;
    }>(
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
        LIMIT 1`,
      [hashToken(`verify:${token}`)],
    );
    if (!row) throw new BadRequestException('Invalid or expired verification link');

    const user = await this.findById(row.user_id);
    await this.db.withTransaction(async (tx) => {
      await tx.execute(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?',
        [row.user_id],
      );
      await tx.execute(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
        [row.id],
      );
    });

    if (user && user.login_status === LoginStatus.PENDING) {
      const admins = await this.db.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE role IN ('SUPER_ADMIN','ADMIN') AND login_status = 'ACTIVE'`,
      );
      const name =
        [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
      await this.notifications.createForMany(
        admins.map((a) => a.id),
        {
          title: 'New login request',
          body: `${name} (${user.email}) verified their email and requested portal access`,
          link: '/admin/login-requests',
        },
      );
      await Promise.all(
        admins.map((a) =>
          this.mail.sendLoginRequestToAdmin(a.email, name, user.email),
        ),
      );
    }

    return { ok: true as const };
  }

  async resetPassword(token: string, password: string) {
    if (!token?.trim()) throw new BadRequestException('Reset token is required');
    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const row = await this.db.queryOne<{
      id: string;
      user_id: string;
    }>(
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
        LIMIT 1`,
      [hashToken(token)],
    );
    if (!row) throw new BadRequestException('Invalid or expired reset token');

    const passwordHash = await argon2.hash(password);
    await this.db.withTransaction(async (tx) => {
      await tx.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
        passwordHash,
        row.user_id,
      ]);
      await tx.execute(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
        [row.id],
      );
      await tx.execute(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
        [row.user_id],
      );
    });
    return { ok: true };
  }

  async confirmEmailChange(token: string) {
    if (!token?.trim()) throw new BadRequestException('Token is required');
    const row = await this.db.queryOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
        LIMIT 1`,
      [hashToken(`email-change:${token}`)],
    );
    if (!row) throw new BadRequestException('Invalid or expired confirmation link');
    const user = await this.db.queryOne<{ pending_email: string | null }>(
      'SELECT pending_email FROM users WHERE id = ? LIMIT 1',
      [row.user_id],
    );
    if (!user?.pending_email) {
      throw new BadRequestException('No email change is pending');
    }
    const taken = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
      [user.pending_email, row.user_id],
    );
    if (taken) throw new ConflictException('That email is already in use');
    await this.db.withTransaction(async (tx) => {
      await tx.execute(
        'UPDATE users SET email = ?, pending_email = NULL, email_verified_at = NOW() WHERE id = ?',
        [user.pending_email, row.user_id],
      );
      await tx.execute(
        'UPDATE customers SET email = ? WHERE user_id = ?',
        [user.pending_email, row.user_id],
      );
      await tx.execute(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
        [row.id],
      );
    });
    return { ok: true as const };
  }

  async listPendingClients() {
    const rows = await this.db.query<
      UserRow & {
        customer_name: string | null;
        customer_id: string | null;
        created_at: Date;
      }
    >(
      `SELECT u.id, u.email, u.password_hash, u.role, u.login_status, u.first_name, u.last_name,
              u.phone, u.custom_role_id, u.created_at, c.name AS customer_name, c.id AS customer_id
         FROM users u
         LEFT JOIN customers c ON c.user_id = u.id AND c.merged_into_id IS NULL
        WHERE u.role = 'CLIENT' AND u.login_status = 'PENDING'
        ORDER BY u.created_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name:
        r.customer_name ||
        [r.first_name, r.last_name].filter(Boolean).join(' ') ||
        r.email,
      phone: r.phone,
      customerId: r.customer_id,
      createdAt: r.created_at,
      firstName: r.first_name,
      lastName: r.last_name,
      loginStatus: r.login_status,
    }));
  }

  async setClientLoginStatus(userId: string, status: LoginStatus) {
    const user = await this.findById(userId);
    if (!user || user.role !== UserRole.CLIENT) {
      throw new NotFoundException('Login request not found');
    }
    await this.db.execute('UPDATE users SET login_status = ? WHERE id = ?', [
      status,
      userId,
    ]);
    if (status === LoginStatus.ACTIVE) {
      await this.notifications.createFor(userId, {
        title: 'Account approved',
        body: 'Your account has been approved. You can sign in now.',
        link: '/login',
      });
      await this.mail.sendAccountApproved(user.email);
    }
    return { ok: true, loginStatus: status };
  }

  async deletePendingClient(userId: string) {
    const user = await this.findById(userId);
    if (!user || user.role !== UserRole.CLIENT) {
      throw new NotFoundException('Login request not found');
    }
    if (user.login_status !== LoginStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be deleted this way');
    }
    await this.db.withTransaction(async (tx) => {
      await tx.execute('DELETE FROM customers WHERE user_id = ?', [userId]);
      await tx.execute('DELETE FROM users WHERE id = ?', [userId]);
    });
    return { ok: true };
  }

  async ensureSeedAdmin() {
    const env = getEnv();
    if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) return;
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    const existing = await this.findByEmail(email);
    if (existing) return;
    const passwordHash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
    await this.db.execute(
      `INSERT INTO users (id, email, password_hash, role, login_status, initials, presence)
       VALUES (?, ?, ?, 'SUPER_ADMIN', 'ACTIVE', 'AD', 'ON')`,
      [randomUUID(), email, passwordHash],
    );
  }
}
