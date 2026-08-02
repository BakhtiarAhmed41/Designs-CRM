import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '../../common/enums';
import type { SupportPermissions } from '../permissions';

export const FEATURES_KEY = 'features';
export const SUPPORT_PERMS_KEY = 'support_perms';

/** Require at least one of the listed feature permissions. */
export const RequireFeatures = (...features: FeatureKey[]) =>
  SetMetadata(FEATURES_KEY, features);

/** Require a support capability (admins always pass). */
export const RequireSupport = (...keys: (keyof SupportPermissions)[]) =>
  SetMetadata(SUPPORT_PERMS_KEY, keys);
