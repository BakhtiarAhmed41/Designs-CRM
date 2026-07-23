import { UserRole } from '../common/enums';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};
