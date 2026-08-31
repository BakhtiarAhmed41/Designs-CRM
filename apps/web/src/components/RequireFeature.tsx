import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canFeature, staffLandingPath } from '@/lib/permissions';
import type { FeatureKey } from '@/lib/types';
import { PageLoading } from '@/components/PageProgress';

/** Blocks admin child routes when the signed-in user lacks a feature. */
export function RequireFeature({
  feature,
  anyOf,
  children,
}: {
  feature?: FeatureKey;
  anyOf?: FeatureKey[];
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoading />;
  }

  const keys = anyOf?.length ? anyOf : feature ? [feature] : [];
  const allowed =
    keys.length === 0 ||
    keys.some((key) => canFeature(user?.permissions, key, user?.role));

  if (!allowed) {
    return <Navigate to={staffLandingPath(user?.role, user?.permissions)} replace />;
  }

  return <>{children}</>;
}

/** Blocks a route unless the signed-in user is Admin or Super Admin. */
export function RequireAdminRole({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoading />;
  }

  const role = user?.role;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    return <Navigate to={staffLandingPath(user?.role, user?.permissions)} replace />;
  }

  return <>{children}</>;
}
