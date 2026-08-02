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

      return { user: result.user };
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

  @Post('refresh')
  async refresh(@Res({ passthrough: true }) res: Response) {
    const req = res.req as { cookies?: Record<string, string> };
    const refreshToken = req.cookies?.refresh_token;
    const refreshTokenId = req.cookies?.refresh_token_id;
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

    return { ok: true };
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    const req = res.req as { cookies?: Record<string, string> };
    await this.auth.logout({
      refreshToken: req.cookies?.refresh_token,
      refreshTokenId: req.cookies?.refresh_token_id,
    });

    const base = getCookieBaseOptions();
    res.clearCookie('access_token', base);
    res.clearCookie('refresh_token', base);
    res.clearCookie('refresh_token_id', base);
    return { ok: true };
  }
}
