/**
 * Central domain enums. These replace the generated `@prisma/client` enums.
 * Each is a plain const object + matching union type so existing code like
 * `UserRole.ADMIN` keeps working and `role: UserRole` remains a valid type.
 * Values map 1:1 to MySQL ENUM / VARCHAR columns.
 */

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  SUPPORT: 'SUPPORT',
  DESIGNER: 'DESIGNER',
  CLIENT: 'CLIENT',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const LoginStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type LoginStatus = (typeof LoginStatus)[keyof typeof LoginStatus];

/** Feature keys used by custom roles (checkbox permissions). */
export const FEATURE_KEYS = [
  'dashboard',
  'messages',
  'messages_customer_view',
  'messages_customer_reply',
  'messages_customer_start',
  'messages_team_view',
  'messages_team_send',
  'messages_group',
  'messages_delete',
  'orders',
  'quotes',
  'edits',
  'customers',
  'billing',
  'team',
  'roles',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const ChatType = {
  GENERAL: 'GENERAL',
  ORDER: 'ORDER',
  QUOTE: 'QUOTE',
} as const;
export type ChatType = (typeof ChatType)[keyof typeof ChatType];

export const ConversationStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type ConversationStatus =
  (typeof ConversationStatus)[keyof typeof ConversationStatus];

/** Roles that belong to internal staff (the admin command center). */
export const STAFF_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
  UserRole.DESIGNER,
];

export const Presence = {
  ON: 'ON',
  AWAY: 'AWAY',
  OFF: 'OFF',
} as const;
export type Presence = (typeof Presence)[keyof typeof Presence];

export const OrderType = {
  ORDER: 'ORDER',
  QUOTE_REQUEST: 'QUOTE_REQUEST',
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export const ServiceType = {
  EMBROIDERY: 'EMBROIDERY',
  SVG: 'SVG',
  VECTOR: 'VECTOR',
  CNC_LASER: 'CNC_LASER',
} as const;
export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];

export const OrderStatus = {
  CREATED: 'CREATED',
  WAITING_FOR_QUOTATION: 'WAITING_FOR_QUOTATION',
  QUOTATION_PROVIDED: 'QUOTATION_PROVIDED',
  CLIENT_REJECTED_QUOTATION: 'CLIENT_REJECTED_QUOTATION',
  WAITING_FOR_ADMIN_QUOTATION_APPROVAL: 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  IN_PROGRESS: 'IN_PROGRESS',
  READY_TO_SEND: 'READY_TO_SEND',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  COMPLETED: 'COMPLETED',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const DesignStatus = {
  WAITING: 'WAITING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  DELIVERED: 'DELIVERED',
} as const;
export type DesignStatus = (typeof DesignStatus)[keyof typeof DesignStatus];

export const QuotationStatus = {
  NEEDS_PRICE: 'NEEDS_PRICE',
  PROPOSED: 'PROPOSED',
  SENT: 'SENT',
  COUNTERED: 'COUNTERED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type QuotationStatus = (typeof QuotationStatus)[keyof typeof QuotationStatus];

export const DeliveredVia = {
  PORTAL: 'PORTAL',
  EMAIL: 'EMAIL',
} as const;
export type DeliveredVia = (typeof DeliveredVia)[keyof typeof DeliveredVia];

export const AccountType = {
  PAY_PER_ORDER: 'PAY_PER_ORDER',
  NET_MONTHLY: 'NET_MONTHLY',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const NetTerms = {
  NET_15: 'NET_15',
  NET_30: 'NET_30',
} as const;
export type NetTerms = (typeof NetTerms)[keyof typeof NetTerms];

export const CustomerSource = {
  PORTAL: 'PORTAL',
  ETSY: 'ETSY',
  GUEST: 'GUEST',
  TEXT: 'TEXT',
} as const;
export type CustomerSource = (typeof CustomerSource)[keyof typeof CustomerSource];

export const EditKind = {
  FREE: 'FREE',
  PAID: 'PAID',
} as const;
export type EditKind = (typeof EditKind)[keyof typeof EditKind];

export const EditStatus = {
  PENDING: 'PENDING',
  DONE: 'DONE',
} as const;
export type EditStatus = (typeof EditStatus)[keyof typeof EditStatus];

export const InvoiceKind = {
  PER_ORDER: 'PER_ORDER',
  MONTHLY: 'MONTHLY',
  ADD_ON: 'ADD_ON',
} as const;
export type InvoiceKind = (typeof InvoiceKind)[keyof typeof InvoiceKind];

export const InvoiceStatus = {
  AWAITING: 'AWAITING',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const OrderPaymentStatus = {
  PAID: 'PAID',
  AWAITING: 'AWAITING',
  UNPAID: 'UNPAID',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderPaymentStatus =
  (typeof OrderPaymentStatus)[keyof typeof OrderPaymentStatus];

export const PaymentMethod = {
  CARD: 'CARD',
  LINK: 'LINK',
  STORE_CREDIT: 'STORE_CREDIT',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentType = {
  CHARGE: 'CHARGE',
  REFUND: 'REFUND',
} as const;
export type PaymentType = (typeof PaymentType)[keyof typeof PaymentType];

export const RefundTo = {
  CARD: 'CARD',
  STORE_CREDIT: 'STORE_CREDIT',
} as const;
export type RefundTo = (typeof RefundTo)[keyof typeof RefundTo];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const MessageLabel = {
  EDIT: 'EDIT',
  PAYMENT: 'PAYMENT',
  CUSTOM: 'CUSTOM',
  IMPORTANT: 'IMPORTANT',
} as const;
export type MessageLabel = (typeof MessageLabel)[keyof typeof MessageLabel];

export const MessageSource = {
  PORTAL: 'PORTAL',
  SITE_CHAT: 'SITE_CHAT',
} as const;
export type MessageSource = (typeof MessageSource)[keyof typeof MessageSource];

export const MessageDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];
