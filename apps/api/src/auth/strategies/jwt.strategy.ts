import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getEnv } from '../../config/env';
import type { AuthUser } from '../auth.types';

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
};

function cookieOrAuthHeaderExtractor(req: { cookies?: Record<string, string>; headers?: any }) {
  const header = req?.headers?.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length);
  }
  const token = req?.cookies?.access_token;
  return token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const env = getEnv();
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieOrAuthHeaderExtractor]),
      secretOrKey: env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role as AuthUser['role'],
    };
  }
}

