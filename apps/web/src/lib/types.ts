export type UserRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'SUPPORT'
  | 'DESIGNER'
  | 'CLIENT';

export const STAFF_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'SUPPORT',
  'DESIGNER',
];

export type FeatureKey =
  | 'dashboard'
  | 'messages'
  | 'messages_customer_view'
  | 'messages_customer_reply'
  | 'messages_customer_start'
  | 'messages_team_view'
  | 'messages_team_send'
  | 'messages_group'
  | 'messages_delete'
  | 'orders'
  | 'quotes'
  | 'edits'
  | 'customers'
  | 'billing'
  | 'team'
  | 'roles';

export type SupportPermissions = {
  money: boolean;
  approve: boolean;
  netTerms: boolean;
  messages: boolean;
};

export type UserPermissions = {
  features: Record<FeatureKey, boolean>;
  support: SupportPermissions;
};

export type CurrentUser = {
  id: string;
  email: string;
  pendingEmail?: string | null;
  role: UserRole;
  loginStatus?: 'PENDING' | 'ACTIVE' | 'DISABLED';
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  customRoleId?: string | null;
  permissions?: UserPermissions;
};

export type OrderStatus =
  | 'CREATED'
  | 'WAITING_FOR_QUOTATION'
  | 'QUOTATION_PROVIDED'
  | 'CLIENT_REJECTED_QUOTATION'
  | 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL'
  | 'PENDING_PAYMENT'
  | 'IN_PROGRESS'
  | 'READY_TO_SEND'
  | 'REVISION_REQUESTED'
  | 'COMPLETED'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED';

export type Quotation = {
  id: string;
  orderId: string;
  version: number;
  status: string;
  createdByRole: UserRole;
  amountCents: number | null;
  currency: string;
  comment: string | null;
  createdAt: string;
};

export type Attachment = {
  id: string;
  orderId: string;
  originalName: string;
};

export type DeliveryFile = {
  id: string;
  originalName: string;
  formatLabel: string | null;
};

export type Delivery = {
  id: string;
  orderId: string;
  version: number;
  deliveredVia: string;
  createdAt: string;
  releasedAt?: string | null;
  files: DeliveryFile[];
};

export type Order = {
  id: string;
  humanRef: string | null;
  customerId?: string | null;
  clientId: string | null;
  type: 'ORDER' | 'QUOTE_REQUEST';
  serviceType: string | null;
  mainCategory: string | null;
  subCategory: string | null;
  name: string | null;
  instructions: string | null;
  size: string | null;
  turnaroundKey?: string | null;
  turnaroundLabel?: string | null;
  turnaroundHours?: number | null;
  preferences: unknown;
  status: OrderStatus;
  designCount?: number;
  priceCents: number | null;
  currency: string;
  assignedDesignerId?: string | null;
  internalNotes?: string | null;
  partiallyAccepted?: boolean;
  createdAt: string;
  updatedAt: string;
  attachments?: Attachment[];
  quotations?: Quotation[];
  deliveries?: Delivery[];
  client?: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName?: string | null;
  } | null;
};

export type Notification = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};
