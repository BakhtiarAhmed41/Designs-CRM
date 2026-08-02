import {
  FEATURE_KEYS,
  UserRole,
  type FeatureKey,
} from '../common/enums';

export type SupportPermissions = {
  money: boolean;
  approve: boolean;
  netTerms: boolean;
  messages: boolean;
};

export type ResolvedPermissions = {
  features: Record<FeatureKey, boolean>;
  support: SupportPermissions;
};

const ALL_FEATURES = Object.fromEntries(
  FEATURE_KEYS.map((k) => [k, true]),
) as Record<FeatureKey, boolean>;

const NONE_FEATURES = Object.fromEntries(
  FEATURE_KEYS.map((k) => [k, false]),
) as Record<FeatureKey, boolean>;

export const DEFAULT_SUPPORT: SupportPermissions = {
  money: false,
  approve: false,
  netTerms: false,
  messages: true,
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

/** If umbrella `messages` is on, fill missing granular messaging keys. */
export function expandMessagingFeatures(
  features: Record<FeatureKey, boolean>,
): Record<FeatureKey, boolean> {
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

export function defaultFeaturesForRole(role: UserRole): Record<FeatureKey, boolean> {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return { ...ALL_FEATURES };
    case UserRole.ADMIN:
      return {
        ...NONE_FEATURES,
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
    case UserRole.SUPPORT:
      return {
        ...NONE_FEATURES,
        dashboard: true,
        ...ALL_MESSAGING,
        messages_delete: false,
        orders: true,
        quotes: true,
        edits: true,
        customers: true,
        billing: false,
        team: false,
        roles: false,
      };
    case UserRole.DESIGNER:
      return {
        ...NONE_FEATURES,
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
      return { ...NONE_FEATURES };
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function parseFeaturePermissions(
  value: unknown,
): Record<FeatureKey, boolean> {
  const obj = parseJsonObject(value);
  const out = { ...NONE_FEATURES };
  for (const key of FEATURE_KEYS) {
    if (key in obj) out[key] = Boolean(obj[key]);
  }
  return out;
}

export function parseSupportPermissions(value: unknown): SupportPermissions {
  const obj = parseJsonObject(value);
  return {
    money: obj.money !== undefined ? Boolean(obj.money) : DEFAULT_SUPPORT.money,
    approve:
      obj.approve !== undefined ? Boolean(obj.approve) : DEFAULT_SUPPORT.approve,
    netTerms:
      obj.netTerms !== undefined
        ? Boolean(obj.netTerms)
        : DEFAULT_SUPPORT.netTerms,
    messages:
      obj.messages !== undefined
        ? Boolean(obj.messages)
        : DEFAULT_SUPPORT.messages,
  };
}

/** Resolve effective nav/API permissions for a staff user. */
export function resolvePermissions(input: {
  role: UserRole;
  userPermissions?: unknown;
  customRolePermissions?: unknown | null;
}): ResolvedPermissions {
  const support = parseSupportPermissions(input.userPermissions);

  if (input.role === UserRole.SUPER_ADMIN) {
    return {
      features: { ...ALL_FEATURES },
      support: {
        money: true,
        approve: true,
        netTerms: true,
        messages: true,
      },
    };
  }

  if (input.role === UserRole.CLIENT) {
    return { features: { ...NONE_FEATURES }, support: { ...DEFAULT_SUPPORT } };
  }

  let features =
    input.customRolePermissions != null
      ? parseFeaturePermissions(input.customRolePermissions)
      : defaultFeaturesForRole(input.role);

  if (input.role === UserRole.ADMIN) {
    // Admins always keep operations + billing; custom roles can add team/roles.
    features = expandMessagingFeatures({
      ...features,
      dashboard: features.dashboard || true,
      messages: true,
      orders: true,
      quotes: true,
      edits: true,
      customers: true,
      billing: true,
    });
    return {
      features,
      support: {
        money: true,
        approve: true,
        netTerms: true,
        messages: true,
      },
    };
  }

  if (input.role === UserRole.SUPPORT) {
    features = expandMessagingFeatures({
      ...features,
      // Support money toggle is the source of truth for billing access.
      billing: support.money,
      messages: support.messages,
      messages_customer_view: support.messages,
      messages_customer_reply: support.messages,
      messages_customer_start: support.messages,
      messages_team_view: support.messages,
      messages_team_send: support.messages,
      messages_group: support.messages,
    });
    return { features, support };
  }

  // DESIGNER and others
  features = expandMessagingFeatures(features);
  return {
    features,
    support: {
      money: false,
      approve: false,
      netTerms: false,
      messages: features.messages,
    },
  };
}

export function hasFeature(
  perms: ResolvedPermissions | undefined,
  feature: FeatureKey,
): boolean {
  return Boolean(perms?.features?.[feature]);
}

export function hasSupportPerm(
  role: UserRole,
  perms: ResolvedPermissions | undefined,
  key: keyof SupportPermissions,
): boolean {
  if (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN) return true;
  return Boolean(perms?.support?.[key]);
}
