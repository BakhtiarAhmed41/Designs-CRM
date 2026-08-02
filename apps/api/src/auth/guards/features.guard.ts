import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '../../common/enums';
import {
  FEATURES_KEY,
  SUPPORT_PERMS_KEY,
} from '../decorators/features.decorator';
import type { AuthUser } from '../auth.types';
import { hasFeature, hasSupportPerm, type SupportPermissions } from '../permissions';

@Injectable()
export class FeaturesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const features = this.reflector.getAllAndOverride<FeatureKey[] | undefined>(
      FEATURES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const supportKeys = this.reflector.getAllAndOverride<
      (keyof SupportPermissions)[] | undefined
    >(SUPPORT_PERMS_KEY, [context.getHandler(), context.getClass()]);

    if ((!features || features.length === 0) && (!supportKeys || supportKeys.length === 0)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException();

    if (features && features.length > 0) {
      const ok = features.some((f) => hasFeature(user.permissions, f));
      if (!ok) throw new ForbiddenException('Missing feature permission');
    }

    if (supportKeys && supportKeys.length > 0) {
      const ok = supportKeys.every((k) =>
        hasSupportPerm(user.role, user.permissions, k),
      );
      if (!ok) throw new ForbiddenException('Missing support permission');
    }

    return true;
  }
}
