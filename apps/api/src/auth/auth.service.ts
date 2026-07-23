import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { UserRole } from '../common/enums';
import { getEnv } from '../config/env';
import { DbService } from '../db/db.service';

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
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    firstName: u.first_name,
    lastName: u.last_name,
    phone: u.phone,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private db: DbService,
    private jwt: JwtService,
  ) {}

  private async findByEmail(email: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(
      'SELECT id, email, password_hash, role, first_name, last_name, phone FROM users WHERE email = ? LIMIT 1',
      [email.toLowerCase()],
    );
  }

  async registerClient(params: { email: string; password: string }) {
    const email = params.email.toLowerCase();
    const existing = await this.findByEmail(email);
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await argon2.hash(params.password);
    const id = randomUUID();
    const initials = email.slice(0, 2).toUpperCase();
    await this.db.execute(
      `INSERT INTO users (id, email, password_hash, role, initials, presence)
       VALUES (?, ?, ?, ?, ?, 'OFF')`,
      [id, email, passwordHash, UserRole.CLIENT, initials],
    );
    return {
      id,
      email,
      role: UserRole.CLIENT,
      firstName: null,
      lastName: null,
      phone: null,
    };
  }

  async validateUser(email: string, password: string): Promise<UserRow> {
    const user = await this.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
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

    const user = await this.db.queryOne<{
      id: string;
      email: string;
      role: UserRole;
    }>('SELECT id, email, role FROM users WHERE id = ? LIMIT 1', [rt.user_id]);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

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

  async ensureSeedAdmin() {
    const env = getEnv();
    if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) return;
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    const existing = await this.findByEmail(email);
    if (existing) return;
    const passwordHash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
    await this.db.execute(
      `INSERT INTO users (id, email, password_hash, role, initials, presence)
       VALUES (?, ?, ?, 'ADMIN', 'AD', 'ON')`,
      [randomUUID(), email, passwordHash],
    );
  }
}
