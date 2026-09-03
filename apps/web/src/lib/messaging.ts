import { apiFetch, apiFetchForm } from './api';

export type MessageLabel = 'EDIT' | 'PAYMENT' | 'CUSTOM' | 'IMPORTANT';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageSource = 'PORTAL' | 'SITE_CHAT';
export type ChatType = 'GENERAL' | 'ORDER' | 'QUOTE';
export type ConversationStatus = 'OPEN' | 'CLOSED';

export type Conversation = {
  id: string;
  customerId: string | null;
  orderId: string | null;
  chatType: ChatType;
  status: ConversationStatus;
  subject: string | null;
  label: MessageLabel | null;
  source: MessageSource;
  archived?: boolean;
  privateNotes?: string | null;
  lastMessageAt: string | null;
  unreadAdmin: number;
  unreadClient: number;
  createdAt: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  orderRef?: string | null;
  orderType?: string | null;
  orderStatus?: string | null;
  lastMessagePreview?: string | null;
};

export type MessageAttachment = {
  id: string;
  messageId?: string;
  originalName: string;
  mimeType: string | null;
  byteSize: number | null;
  url: string;
  createdAt?: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  direction: MessageDirection;
  body: string;
  replyToMessageId?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  attachments?: MessageAttachment[];
};

export type ConversationDetail = Conversation & {
  messages: Message[];
};

export type MessageTemplate = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

export type CustomerMessagingContext = {
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    accountType: string | null;
    createdAt: string;
    customerSince: string | null;
    notes: string | null;
    preferredBranch: string | null;
    assignedSalesperson: string | null;
    totalOrders: number;
    totalSpentCents: number;
    lastOrderAt: string | null;
    lastContactAt: string | null;
  };
  recentOrders: Array<{
    id: string;
    humanRef: string | null;
    status: string;
    totalCents: number | null;
    createdAt: string;
  }>;
  recentQuotes: Array<{
    id: string;
    humanRef: string | null;
    status: string;
    totalCents: number | null;
    createdAt: string;
  }>;
  conversations: Conversation[];
};

export type SearchResults = {
  orders: Array<{ id: string; ref: string | null; name: string | null; status: string }>;
  customers: Array<{ id: string; name: string | null; email: string | null }>;
  conversations: Array<{ id: string; subject: string | null }>;
};

function buildMessageForm(body: string, files?: File[], replyToMessageId?: string | null) {
  const form = new FormData();
  form.append('body', body);
  if (replyToMessageId) form.append('replyToMessageId', replyToMessageId);
  for (const f of files ?? []) form.append('files', f);
  return form;
}

export function chatTypeLabel(type: ChatType | undefined) {
  switch (type) {
    case 'ORDER':
      return 'Order';
    case 'QUOTE':
      return 'Quote';
    default:
      return 'Topic';
  }
}

/** True for old/default GENERAL subjects that aren't a real topic. */
export function isPlaceholderSubject(subject: string | null | undefined) {
  if (!subject?.trim()) return true;
  const s = subject.trim().toLowerCase();
  return (
    s === 'general' ||
    s === 'general inquiry' ||
    s === 'new chat' ||
    s === 'new inquiry'
  );
}

function truncateTitle(text: string, max = 72) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Display title for a conversation. Prefers real subject / order ref over "General". */
export function conversationTitle(c: {
  chatType?: ChatType;
  subject?: string | null;
  orderRef?: string | null;
  lastMessagePreview?: string | null;
}) {
  if (c.chatType === 'ORDER') {
    if (c.orderRef) return `Order ${c.orderRef}`;
    if (c.subject?.trim() && !isPlaceholderSubject(c.subject)) return c.subject.trim();
    return 'Order chat';
  }
  if (c.chatType === 'QUOTE') {
    if (c.orderRef) return `Quote ${c.orderRef}`;
    if (c.subject?.trim() && !isPlaceholderSubject(c.subject)) return c.subject.trim();
    return 'Quote chat';
  }
  if (c.subject?.trim() && !isPlaceholderSubject(c.subject)) {
    return c.subject.trim();
  }
  if (c.lastMessagePreview?.trim()) {
    return truncateTitle(c.lastMessagePreview);
  }
  if (c.subject?.trim()) return c.subject.trim();
  return 'New chat';
}

// --- admin ----------------------------------------------------------------
export function listAdminConversations(params?: {
  label?: string;
  q?: string;
  archived?: boolean;
  unread?: boolean;
  read?: boolean;
  status?: ConversationStatus;
  chatType?: ChatType;
  customerId?: string;
  orderId?: string;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.label) q.set('label', params.label);
  if (params?.q) q.set('q', params.q);
  if (params?.archived) q.set('archived', '1');
  if (params?.unread) q.set('unread', '1');
  if (params?.read) q.set('read', '1');
  if (params?.status) q.set('status', params.status);
  if (params?.chatType) q.set('chatType', params.chatType);
  if (params?.customerId) q.set('customerId', params.customerId);
  if (params?.orderId) q.set('orderId', params.orderId);
  if (params?.limit) q.set('limit', String(params.limit));
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<{ conversations: Conversation[] }>(
    `/admin/conversations${suffix}`,
  );
}

export function getAdminUnreadSummary() {
  return apiFetch<{ unreadMessages: number; unreadConversations: number }>(
    '/admin/conversations/unread-summary',
  );
}

export function getCustomerMessagingContext(customerId: string) {
  return apiFetch<CustomerMessagingContext>(
    `/admin/customers/${customerId}/messaging-context`,
  );
}

export function getAdminConversation(id: string) {
  return apiFetch<{ conversation: ConversationDetail }>(
    `/admin/conversations/${id}`,
  );
}

export function createAdminConversation(data: {
  customerId?: string | null;
  orderId?: string | null;
  subject?: string | null;
  label?: MessageLabel | null;
  chatType?: ChatType;
}) {
  return apiFetch<{ conversation: Conversation }>('/admin/conversations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function sendAdminMessage(
  conversationId: string,
  body: string,
  files?: File[],
  replyToMessageId?: string | null,
) {
  return apiFetchForm<{ conversation: Conversation; message: Message }>(
    `/admin/conversations/${conversationId}/messages`,
    buildMessageForm(body, files, replyToMessageId),
  );
}

export function updateAdminConversation(
  conversationId: string,
  data: {
    label?: MessageLabel | null;
    subject?: string | null;
    archived?: boolean;
    privateNotes?: string | null;
    status?: ConversationStatus;
  },
) {
  return apiFetch<{ conversation: Conversation }>(
    `/admin/conversations/${conversationId}`,
    { method: 'PATCH', body: JSON.stringify(data) },
  );
}

export function deleteAdminConversation(conversationId: string) {
  return apiFetch<{ ok: boolean }>(`/admin/conversations/${conversationId}`, {
    method: 'DELETE',
  });
}

export function deleteAdminMessage(id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/messages/${id}`, { method: 'DELETE' });
}

// --- templates ------------------------------------------------------------
export function listMessageTemplates() {
  return apiFetch<{ templates: MessageTemplate[] }>('/admin/message-templates');
}

export function createMessageTemplate(data: { title: string; body: string }) {
  return apiFetch<{ template: MessageTemplate }>('/admin/message-templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteMessageTemplate(id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/message-templates/${id}`, {
    method: 'DELETE',
  });
}

// --- customer -------------------------------------------------------------
export function listMyConversations() {
  return apiFetch<{ conversations: Conversation[] }>('/conversations');
}

export function getMyUnreadSummary() {
  return apiFetch<{ unreadMessages: number; unreadConversations: number }>(
    '/conversations/unread-summary',
  );
}

export function getMyConversation(id: string) {
  return apiFetch<{ conversation: ConversationDetail }>(`/conversations/${id}`);
}

export function createMyConversation(data: {
  subject?: string | null;
  orderId?: string | null;
  label?: MessageLabel | null;
  chatType?: ChatType;
}) {
  return apiFetch<{ conversation: Conversation }>('/conversations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** Open the one quote/order chat for this record, or create it if none exists. */
export async function openLinkedChat(opts: {
  orderId: string;
  chatType: 'ORDER' | 'QUOTE';
  subject?: string;
}) {
  const listed = await listMyConversations();
  const existing = listed.conversations.find(
    (c) =>
      c.orderId === opts.orderId &&
      (c.chatType === 'ORDER' || c.chatType === 'QUOTE'),
  );
  if (existing) return existing;
  const created = await createMyConversation({
    orderId: opts.orderId,
    chatType: opts.chatType,
    subject: opts.subject,
  });
  return created.conversation;
}

export function deleteMyConversation(conversationId: string) {
  return apiFetch<{ ok: boolean }>(`/conversations/${conversationId}`, {
    method: 'DELETE',
  });
}

export function sendMyMessage(
  conversationId: string,
  body: string,
  files?: File[],
  replyToMessageId?: string | null,
) {
  return apiFetchForm<{ conversation: Conversation; message: Message }>(
    `/conversations/${conversationId}/messages`,
    buildMessageForm(body, files, replyToMessageId),
  );
}

// --- global search --------------------------------------------------------
export function globalSearch(q: string) {
  return apiFetch<SearchResults>(
    `/admin/search?q=${encodeURIComponent(q)}`,
  );
}
