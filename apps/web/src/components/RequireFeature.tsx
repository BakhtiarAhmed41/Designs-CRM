import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canFeature } from '@/lib/permissions';
import type { FeatureKey } from '@/lib/types';

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
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }

  const keys = anyOf?.length ? anyOf : feature ? [feature] : [];
  const allowed =
    keys.length === 0 ||
    keys.some((key) => canFeature(user?.permissions, key, user?.role));

  if (!allowed) {
    // Prefer My work for designers / staff without the requested feature.
    const fallback =
      user?.role === 'DESIGNER' ? '/admin/mywork' : '/admin';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
