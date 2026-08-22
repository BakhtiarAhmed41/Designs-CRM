import type { FeatureKey, SupportPermissions, UserPermissions, UserRole } from './types';

const NONE: Record<FeatureKey, boolean> = {
  dashboard: false,
  messages: false,
  messages_customer_view: false,
  messages_customer_reply: false,
  messages_customer_start: false,
  messages_team_view: false,
  messages_team_send: false,
  messages_group: false,
  messages_delete: false,
  orders: false,
  quotes: false,
  edits: false,
  customers: false,
  billing: false,
  team: false,
  roles: false,
};

const ALL_MESSAGING: Partial<Record<FeatureKey, boolean>> = {
  messages: true,
  messages_customer_view: true,
  messages_customer_reply: true,
  messages_customer_start: true,
  messages_team_view: true,
  messages_team_send: true,
  messages_group: true,
  messages_delete: true,
};

function expandMessaging(features: Record<FeatureKey, boolean>) {
  if (!features.messages) return features;
  return {
    ...features,
    // Preserve explicit false; only fill keys that were omitted.
    messages_customer_view: features.messages_customer_view ?? true,
    messages_customer_reply: features.messages_customer_reply ?? true,
    messages_customer_start: features.messages_customer_start ?? true,
    messages_team_view: features.messages_team_view ?? true,
    messages_team_send: features.messages_team_send ?? true,
    messages_group: features.messages_group ?? true,
    messages_delete: features.messages_delete ?? true,
  };
}

/** What this role can do when no custom permission set is stored. */
export function defaultFeaturesForRole(role: UserRole): Record<FeatureKey, boolean> {
  switch (role) {
    case 'SUPER_ADMIN':
      return {
        dashboard: true,
        ...ALL_MESSAGING,
        orders: true,
        quotes: true,
        edits: true,
        customers: true,
        billing: true,
        team: true,
        roles: true,
      } as Record<FeatureKey, boolean>;
    case 'ADMIN':
      return {
        ...NONE,
        dashboard: true,
        ...ALL_MESSAGING,
        orders: true,
        quotes: true,
        edits: true,
        customers: true,
        billing: true,
        team: true,
        roles: true,
      };
    case 'SUPPORT':
      return {
        ...NONE,
        dashboard: true,
        ...ALL_MESSAGING,
        messages_delete: false,
        orders: true,
        quotes: true,
        edits: true,
        customers: true,
      };
    case 'DESIGNER':
      return {
        ...NONE,
        messages: true,
        messages_customer_view: true,
        messages_customer_reply: true,
        messages_customer_start: false,
        messages_team_view: true,
        messages_team_send: true,
        messages_group: true,
        messages_delete: false,
        orders: true,
        edits: true,
      };
    default:
      return { ...NONE };
  }
}

export function featuresForUser(
  role: UserRole,
  permissions?: UserPermissions,
): Record<FeatureKey, boolean> {
  if (permissions?.features) {
    return expandMessaging({ ...NONE, ...permissions.features });
  }
  return expandMessaging(defaultFeaturesForRole(role));
}

/** @deprecated Use featuresForUser. Nav always follows the signed-in user. */
export function featuresForNav(
  actualRole: UserRole,
  _viewAs: UserRole,
  permissions?: UserPermissions,
): Record<FeatureKey, boolean> {
  return featuresForUser(actualRole, permissions);
}

export function staffLandingPath(
  role: UserRole | undefined,
  permissions?: UserPermissions,
): string {
  const features = featuresForUser(role ?? 'ADMIN', permissions);
  if (features.dashboard) return '/admin';
  if (role === 'DESIGNER') return '/admin/mywork';
  if (features.orders) return '/admin/orders';
  if (features.messages || features.messages_customer_view) return '/admin/messages/customers';
  if (features.messages_team_view) return '/admin/messages/team';
  if (features.quotes) return '/admin/quotes';
  return '/admin/mywork';
}

export function canFeature(
  permissions: UserPermissions | undefined,
  feature: FeatureKey,
  role?: UserRole,
): boolean {
  if (permissions?.features) {
    return Boolean(expandMessaging({ ...NONE, ...permissions.features })[feature]);
  }
  if (role) {
    return Boolean(expandMessaging(defaultFeaturesForRole(role))[feature]);
  }
  return false;
}

export function canSupport(
  permissions: UserPermissions | undefined,
  key: keyof SupportPermissions,
  role?: UserRole,
): boolean {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  return Boolean(permissions?.support?.[key]);
}

export function canAnyMessaging(features: Record<FeatureKey, boolean>) {
  return Boolean(
    features.messages ||
      features.messages_customer_view ||
      features.messages_team_view,
  );
}
