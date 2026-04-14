import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { getEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

type Tokens = {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async registerClient(params: { email: string; password: string }) {
    const passwordHash = await argon2.hash(params.password);
    const user = await this.prisma.user.create({
      data: {
        email: params.email.toLowerCase(),
        passwordHash,
        role: UserRole.CLIENT,
      },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true },
    });
    return user;
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  private async issueTokens(user: { id: string; email: string; role: UserRole }): Promise<Tokens> {
    const env = getEnv();
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const refreshTokenHash = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);

    const rt = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt,
      },
      select: { id: true },
    });

    return { accessToken, refreshToken, refreshTokenId: rt.id };
  }

  async login(params: { email: string; password: string }) {
    const user = await this.validateUser(params.email, params.password);
    const tokens = await this.issueTokens(user);
    return {
      user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
      tokens,
    };
  }

  async refresh(params: { refreshToken: string; refreshTokenId: string }) {
    const env = getEnv();
    const rt = await this.prisma.refreshToken.findFirst({
      where: {
        id: params.refreshTokenId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, tokenHash: true, userId: true },
    });
    if (!rt) throw new UnauthorizedException('Invalid refresh token');

    const ok = await argon2.verify(rt.tokenHash, params.refreshToken);
    if (!ok) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.prisma.user.findUnique({
      where: { id: rt.userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    const next = await this.issueTokens(user);

    await this.prisma.refreshToken.update({
      where: { id: rt.id },
      data: { revokedAt: new Date(), replacedById: next.refreshTokenId },
    });

    return {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      refreshTokenId: next.refreshTokenId,
    };
  }

  async logout(params: { refreshToken?: string; refreshTokenId?: string }) {
    if (!params.refreshToken || !params.refreshTokenId) return;

    const rt = await this.prisma.refreshToken.findFirst({
      where: { id: params.refreshTokenId, revokedAt: null },
      select: { id: true, tokenHash: true },
    });
    if (!rt) return;

    const ok = await argon2.verify(rt.tokenHash, params.refreshToken);
    if (!ok) return;

    await this.prisma.refreshToken.update({ where: { id: rt.id }, data: { revokedAt: new Date() } });
  }

  async ensureSeedAdmin() {
    const env = getEnv();
    if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) return;

    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;

    const passwordHash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
    await this.prisma.user.create({
      data: { email, passwordHash, role: UserRole.ADMIN },
    });
  }
}

