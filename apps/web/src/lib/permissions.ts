import type { FeatureKey, UserPermissions, UserRole } from './types';

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
    messages_customer_view: features.messages_customer_view || true,
    messages_customer_reply: features.messages_customer_reply || true,
    messages_customer_start: features.messages_customer_start || true,
    messages_team_view: features.messages_team_view || true,
    messages_team_send: features.messages_team_send || true,
    messages_group: features.messages_group || true,
    messages_delete: features.messages_delete || true,
  };
}

/** Role defaults used for Super Admin “Viewing as” preview only. */
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

export function featuresForNav(
  actualRole: UserRole,
  viewAs: UserRole,
  permissions?: UserPermissions,
): Record<FeatureKey, boolean> {
  if (viewAs === actualRole && permissions?.features) {
    return expandMessaging({ ...NONE, ...permissions.features });
  }
  return expandMessaging(defaultFeaturesForRole(viewAs));
}

export function canFeature(
  permissions: UserPermissions | undefined,
  feature: FeatureKey,
): boolean {
  return Boolean(permissions?.features?.[feature]);
}

export function canAnyMessaging(features: Record<FeatureKey, boolean>) {
  return Boolean(
    features.messages ||
      features.messages_customer_view ||
      features.messages_team_view,
  );
}
