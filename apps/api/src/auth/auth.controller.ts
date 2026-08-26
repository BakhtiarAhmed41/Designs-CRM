import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  InternalServerErrorException,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { getEnv } from '../config/env';
import { getCookieBaseOptions } from './auth.cookies';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
  name: z.string().min(1).max(200),
  phone: z.string().min(3).max(60).optional().nullable(),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6).max(200),
});

const verifySchema = z.object({
  token: z.string().min(10),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.issues.map((i) => i.message).join(', '));
    }
    throw err;
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  async register(@Body() body: unknown) {
    const data = parseBody(registerSchema, body);
    try {
      return await this.auth.registerClient(data);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Register failed',
      );
    }
  }

  @Post('login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parseBody(loginSchema, body);
    try {
      const result = await this.auth.login({ email, password });

      const env = getEnv();
      const base = getCookieBaseOptions();

      res.cookie('access_token', result.tokens.accessToken, {
        ...base,
        maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000,
      });
      res.cookie('refresh_token', result.tokens.refreshToken, {
        ...base,
        maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
      });
      res.cookie('refresh_token_id', result.tokens.refreshTokenId, {
        ...base,
        maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
      });

      // Also return tokens so the website can send Authorization when
      // cross-site cookies are blocked (Vercel site + Belmo API).
      return { user: result.user, ...result.tokens };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Login failed',
      );
    }
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: unknown) {
    const { email } = parseBody(forgotSchema, body);
    return this.auth.requestPasswordReset(email);
  }

  @Post('reset-password')
  async resetPassword(@Body() body: unknown) {
    const data = parseBody(resetSchema, body);
    return this.auth.resetPassword(data.token, data.password);
  }

  @Post('verify-email')
  async verifyEmail(@Body() body: unknown) {
    const { token } = parseBody(verifySchema, body);
    return this.auth.verifyEmail(token);
  }

  @Post('confirm-email-change')
  async confirmEmailChange(@Body() body: unknown) {
    const { token } = parseBody(verifySchema, body);
    return this.auth.confirmEmailChange(token);
  }

  @Post('refresh')
  async refresh(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const req = res.req as { cookies?: Record<string, string> };
    const fromBody = z
      .object({
        refreshToken: z.string().min(1).optional(),
        refreshTokenId: z.string().min(1).optional(),
      })
      .safeParse(body ?? {});
    const refreshToken = req.cookies?.refresh_token || fromBody.data?.refreshToken;
    const refreshTokenId = req.cookies?.refresh_token_id || fromBody.data?.refreshTokenId;
    if (!refreshToken || !refreshTokenId) return { ok: false };

    const next = await this.auth.refresh({ refreshToken, refreshTokenId });
    const env = getEnv();
    const base = getCookieBaseOptions();

    res.cookie('access_token', next.accessToken, {
      ...base,
      maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000,
    });
    res.cookie('refresh_token', next.refreshToken, {
      ...base,
      maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
    });
    res.cookie('refresh_token_id', next.refreshTokenId, {
      ...base,
      maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
    });

    return { ok: true, ...next };
  }

  @Post('logout')
  async logout(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const req = res.req as { cookies?: Record<string, string> };
    const fromBody = z
      .object({
        refreshToken: z.string().min(1).optional(),
        refreshTokenId: z.string().min(1).optional(),
      })
      .safeParse(body ?? {});
    await this.auth.logout({
      refreshToken: req.cookies?.refresh_token || fromBody.data?.refreshToken,
      refreshTokenId: req.cookies?.refresh_token_id || fromBody.data?.refreshTokenId,
    });

    const base = getCookieBaseOptions();
    res.clearCookie('access_token', base);
    res.clearCookie('refresh_token', base);
    res.clearCookie('refresh_token_id', base);
    return { ok: true };
  }
}
