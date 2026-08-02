import { UserRole } from '../common/enums';
import type { ResolvedPermissions } from './permissions';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  permissions: ResolvedPermissions;
};
