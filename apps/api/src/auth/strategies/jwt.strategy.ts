import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getEnv } from '../../config/env';
import { DbService } from '../../db/db.service';
import { UserRole } from '../../common/enums';
import type { AuthUser } from '../auth.types';
import { resolvePermissions } from '../permissions';

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
};

function cookieOrAuthHeaderExtractor(req: {
  cookies?: Record<string, string>;
  headers?: { authorization?: string };
}) {
  const header = req?.headers?.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length);
  }
  const token = req?.cookies?.access_token;
  return token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private db: DbService) {
    const env = getEnv();
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieOrAuthHeaderExtractor]),
      secretOrKey: env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const role = payload.role as UserRole;
    const row = await this.db.queryOne<{
      id: string;
      email: string;
      role: UserRole;
      login_status: string;
      permissions: unknown;
      custom_role_id: string | null;
      cr_permissions: unknown | null;
    }>(
      `SELECT u.id, u.email, u.role, u.login_status, u.permissions, u.custom_role_id,
              r.permissions AS cr_permissions
         FROM users u
         LEFT JOIN custom_roles r ON r.id = u.custom_role_id
        WHERE u.id = ?
        LIMIT 1`,
      [payload.sub],
    );

    if (!row || row.login_status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    const permissions = resolvePermissions({
      role: row.role ?? role,
      userPermissions: row.permissions,
      customRolePermissions: row.cr_permissions ?? null,
    });

    return {
      id: row.id,
      email: row.email ?? payload.email,
      role: row.role ?? role,
      permissions,
    };
  }
}
