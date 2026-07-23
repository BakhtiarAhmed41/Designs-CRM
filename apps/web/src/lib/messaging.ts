import { apiFetch } from './api';

export type MessageLabel = 'EDIT' | 'PAYMENT' | 'CUSTOM' | 'IMPORTANT';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageSource = 'PORTAL' | 'SITE_CHAT';

export type Conversation = {
  id: string;
  customerId: string | null;
  orderId: string | null;
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
  orderRef?: string | null;
  lastMessagePreview?: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  direction: MessageDirection;
  body: string;
  createdAt: string;
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

export type SearchResults = {
  orders: Array<{ id: string; ref: string | null; name: string | null; status: string }>;
  customers: Array<{ id: string; name: string | null; email: string | null }>;
  conversations: Array<{ id: string; subject: string | null }>;
};

// --- admin ----------------------------------------------------------------
export function listAdminConversations(params?: {
  label?: string;
  q?: string;
  archived?: boolean;
}) {
  const q = new URLSearchParams();
  if (params?.label) q.set('label', params.label);
  if (params?.q) q.set('q', params.q);
  if (params?.archived) q.set('archived', '1');
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<{ conversations: Conversation[] }>(
    `/admin/conversations${suffix}`,
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
}) {
  return apiFetch<{ conversation: Conversation }>('/admin/conversations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function sendAdminMessage(conversationId: string, body: string) {
  return apiFetch<{ conversation: Conversation; message: Message }>(
    `/admin/conversations/${conversationId}/messages`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
}

export function updateAdminConversation(
  conversationId: string,
  data: {
    label?: MessageLabel | null;
    subject?: string | null;
    archived?: boolean;
    privateNotes?: string | null;
  },
) {
  return apiFetch<{ conversation: Conversation }>(
    `/admin/conversations/${conversationId}`,
    { method: 'PATCH', body: JSON.stringify(data) },
  );
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

export function getMyConversation(id: string) {
  return apiFetch<{ conversation: ConversationDetail }>(`/conversations/${id}`);
}

export function createMyConversation(data: {
  subject?: string | null;
  orderId?: string | null;
  label?: MessageLabel | null;
}) {
  return apiFetch<{ conversation: Conversation }>('/conversations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function sendMyMessage(conversationId: string, body: string) {
  return apiFetch<{ conversation: Conversation; message: Message }>(
    `/conversations/${conversationId}/messages`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
}

// --- global search --------------------------------------------------------
export function globalSearch(q: string) {
  return apiFetch<SearchResults>(
    `/admin/search?q=${encodeURIComponent(q)}`,
  );
}
