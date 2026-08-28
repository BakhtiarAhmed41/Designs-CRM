import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import {
  ChatType,
  ConversationStatus,
  MessageDirection,
  MessageLabel,
  MessageSource,
  OrderType,
  UserRole,
} from '../common/enums';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { MessagingGateway } from './messaging.gateway';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

type ConversationRow = {
  id: string;
  customer_id: string | null;
  order_id: string | null;
  chat_type: ChatType;
  status: ConversationStatus;
  subject: string | null;
  label: MessageLabel | null;
  source: MessageSource;
  archived: number | boolean;
  private_notes: string | null;
  last_message_at: Date | null;
  unread_admin: number;
  unread_client: number;
  created_at: Date;
};

type ConversationListRow = ConversationRow & {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  order_ref: string | null;
  order_type: string | null;
  order_status: string | null;
  last_body: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  direction: MessageDirection;
  body: string;
  reply_to_message_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  original_name: string;
  mime_type: string | null;
  byte_size: number | null;
  storage_key: string;
  created_at: Date;
};

type TemplateRow = {
  id: string;
  title: string;
  body: string;
  created_at: Date;
};

export type UploadFile = {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
};

const STAFF_NOTIFY_ROLES = "('SUPER_ADMIN','ADMIN','SUPPORT','DESIGNER')";

@Injectable()
export class MessagingService {
  constructor(
    private db: DbService,
    private notifications: NotificationsService,
    private storage: LocalStorageService,
    @Optional()
    @Inject(forwardRef(() => MessagingGateway))
    private gateway?: MessagingGateway,
  ) {}

  private conversationDto(c: ConversationRow, stripPrivate = false) {
    return {
      id: c.id,
      customerId: c.customer_id,
      orderId: c.order_id,
      chatType: c.chat_type ?? ChatType.GENERAL,
      status: c.status ?? ConversationStatus.OPEN,
      subject: c.subject,
      label: c.label,
      source: c.source,
      archived: Boolean(c.archived),
      privateNotes: stripPrivate ? null : c.private_notes,
      lastMessageAt: c.last_message_at,
      unreadAdmin: Number(c.unread_admin ?? 0),
      unreadClient: Number(c.unread_client ?? 0),
      createdAt: c.created_at,
    };
  }

  private conversationListDto(c: ConversationListRow, stripPrivate = false) {
    return {
      ...this.conversationDto(c, stripPrivate),
      customerName: c.customer_name,
      customerEmail: c.customer_email ?? null,
      customerPhone: c.customer_phone ?? null,
      orderRef: c.order_ref,
      orderType: c.order_type ?? null,
      orderStatus: c.order_status ?? null,
      lastMessagePreview: c.last_body,
    };
  }

  private async attachmentDto(a: AttachmentRow) {
    const url = await this.storage.createSignedUrl({
      key: a.storage_key,
      downloadAs: a.original_name,
    });
    return {
      id: a.id,
      messageId: a.message_id,
      originalName: a.original_name,
      mimeType: a.mime_type,
      byteSize: a.byte_size,
      url,
      createdAt: a.created_at,
    };
  }

  private messageDto(
    m: MessageRow,
    attachments: Awaited<ReturnType<MessagingService['attachmentDto']>>[] = [],
  ) {
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderUserId: m.sender_user_id,
      direction: m.direction,
      body: m.deleted_at ? '' : m.body,
      replyToMessageId: m.reply_to_message_id,
      deletedAt: m.deleted_at,
      createdAt: m.created_at,
      attachments,
    };
  }

  private templateDto(t: TemplateRow) {
    return {
      id: t.id,
      title: t.title,
      body: t.body,
      createdAt: t.created_at,
    };
  }

  private async getConversationRow(id: string): Promise<ConversationRow | null> {
    return this.db.queryOne<ConversationRow>(
      'SELECT * FROM conversations WHERE id = ? LIMIT 1',
      [id],
    );
  }

  private async getAttachmentsForMessages(messageIds: string[]) {
    if (messageIds.length === 0) return new Map<string, AttachmentRow[]>();
    const placeholders = messageIds.map(() => '?').join(',');
    const rows = await this.db.query<AttachmentRow>(
      `SELECT * FROM message_attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
      messageIds,
    );
    const map = new Map<string, AttachmentRow[]>();
    for (const row of rows) {
      const list = map.get(row.message_id) ?? [];
      list.push(row);
      map.set(row.message_id, list);
    }
    return map;
  }

  private async getMessages(conversationId: string) {
    const rows = await this.db.query<MessageRow>(
      `SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC`,
      [conversationId],
    );
    const attMap = await this.getAttachmentsForMessages(rows.map((r) => r.id));
    const out = [];
    for (const m of rows) {
      const atts = attMap.get(m.id) ?? [];
      const mapped = await Promise.all(atts.map((a) => this.attachmentDto(a)));
      out.push(this.messageDto(m, mapped));
    }
    return out;
  }

  private async getCustomerIdForUser(userId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM customers WHERE user_id = ? LIMIT 1',
      [userId],
    );
    return row?.id ?? null;
  }

  private async staffUserIds(): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE role IN ${STAFF_NOTIFY_ROLES}`,
    );
    return rows.map((r) => r.id);
  }

  private async resolveChatType(
    chatType: ChatType | undefined,
    orderId: string | null,
  ): Promise<ChatType> {
    if (chatType) return chatType;
    if (!orderId) return ChatType.GENERAL;
    const order = await this.db.queryOne<{ type: string }>(
      'SELECT type FROM orders WHERE id = ? LIMIT 1',
      [orderId],
    );
    if (!order) throw new NotFoundException('Order not found');
    return order.type === OrderType.QUOTE_REQUEST
      ? ChatType.QUOTE
      : ChatType.ORDER;
  }

  private defaultSubject(chatType: ChatType, orderRef: string | null) {
    if (chatType === ChatType.GENERAL) return null;
    if (chatType === ChatType.QUOTE) {
      return orderRef ? `Quotation ${orderRef} Chat` : 'Quotation Chat';
    }
    return orderRef ? `Order ${orderRef} Chat` : 'Order Chat';
  }

  private isPlaceholderGeneralSubject(
    subject: string | null,
    chatType: string | ChatType,
  ) {
    if (chatType !== ChatType.GENERAL) return false;
    if (!subject?.trim()) return true;
    const s = subject.trim().toLowerCase();
    return (
      s === 'general' ||
      s === 'general inquiry' ||
      s === 'new chat' ||
      s === 'new inquiry'
    );
  }

  private async adoptSubjectFromFirstMessage(
    convo: ConversationRow,
    text: string,
  ) {
    if (!this.isPlaceholderGeneralSubject(convo.subject, convo.chat_type)) {
      return;
    }
    const title = text.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!title || title === '(attachment)') return;
    await this.db.execute('UPDATE conversations SET subject = ? WHERE id = ?', [
      title,
      convo.id,
    ]);
  }

  private async findOpenTypedChat(
    customerId: string,
    chatType: ChatType,
    orderId: string,
  ) {
    return this.db.queryOne<ConversationRow>(
      `SELECT * FROM conversations
        WHERE customer_id = ? AND chat_type = ? AND order_id = ? AND status = 'OPEN'
        ORDER BY created_at DESC LIMIT 1`,
      [customerId, chatType, orderId],
    );
  }

  private async saveAttachments(messageId: string, files: UploadFile[]) {
    const out = [];
    for (const file of files) {
      try {
        const key = this.storage.newObjectKey(
          ['messages', messageId, 'attachments'],
          file.originalname,
        );
        await this.storage.uploadObject({
          key,
          body: file.buffer,
          contentType: file.mimetype,
        });
        const id = this.db.uuid();
        await this.db.execute(
          `INSERT INTO message_attachments
             (id, message_id, original_name, mime_type, byte_size, storage_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            messageId,
            file.originalname.slice(0, 255),
            file.mimetype ?? null,
            file.size,
            key,
          ],
        );
        const row = await this.db.queryOne<AttachmentRow>(
          'SELECT * FROM message_attachments WHERE id = ? LIMIT 1',
          [id],
        );
        if (row) out.push(await this.attachmentDto(row));
      } catch (err) {
        throw new BadRequestException(
          `Could not save attachment "${file.originalname}": ${
            err instanceof Error ? err.message : 'upload failed'
          }`,
        );
      }
    }
    return out;
  }

  private emitConversation(event: string, payload: Record<string, unknown>) {
    this.gateway?.emitToConversation(
      String(payload.conversationId ?? ''),
      event,
      payload,
    );
    this.gateway?.server?.emit('unread:changed', { scope: 'customer' });
  }

  // --- admin flows ---------------------------------------------------------

  async listAdminConversations(
    user: AuthUser | undefined,
    filters: {
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
    },
  ) {
    assertAuthUser(user);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.archived) {
      where.push('c.archived = 1');
    } else {
      where.push('(c.archived = 0 OR c.archived IS NULL)');
    }

    const labels = Object.values(MessageLabel) as string[];
    if (filters.label && labels.includes(filters.label)) {
      where.push('c.label = ?');
      params.push(filters.label);
    }

    if (filters.unread) where.push('c.unread_admin > 0');
    if (filters.read) where.push('c.unread_admin = 0');
    if (filters.status) {
      where.push('c.status = ?');
      params.push(filters.status);
    }
    if (filters.chatType) {
      where.push('c.chat_type = ?');
      params.push(filters.chatType);
    }
    if (filters.customerId) {
      where.push('c.customer_id = ?');
      params.push(filters.customerId);
    }
    if (filters.orderId) {
      where.push('c.order_id = ?');
      params.push(filters.orderId);
    }

    const q = filters.q?.trim();
    if (q) {
      const like = `%${q}%`;
      where.push(
        `(c.id = ? OR c.subject LIKE ? OR cust.name LIKE ? OR cust.email LIKE ? OR cust.phone LIKE ?
          OR o.human_ref LIKE ?
          OR EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.body LIKE ? AND m2.deleted_at IS NULL))`,
      );
      params.push(q, like, like, like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit =
      filters.limit && Number.isFinite(filters.limit)
        ? Math.min(100, Math.max(1, Math.floor(filters.limit)))
        : undefined;
    const rows = await this.db.query<ConversationListRow>(
      `SELECT c.*,
              cust.name AS customer_name,
              cust.email AS customer_email,
              cust.phone AS customer_phone,
              o.human_ref AS order_ref,
              o.type AS order_type,
              o.status AS order_status,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_body
         FROM conversations c
         LEFT JOIN customers cust ON cust.id = c.customer_id
         LEFT JOIN orders o ON o.id = c.order_id
         ${whereSql}
         ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.created_at DESC
         ${limit ? 'LIMIT ?' : ''}`,
      limit ? [...params, limit] : params,
    );
    return rows.map((r) => this.conversationListDto(r));
  }

  async adminUnreadSummary(user: AuthUser | undefined) {
    assertAuthUser(user);
    const row = await this.db.queryOne<{
      total: number;
      conversations: number;
    }>(
      `SELECT COALESCE(SUM(unread_admin), 0) AS total,
              COALESCE(SUM(CASE WHEN unread_admin > 0 THEN 1 ELSE 0 END), 0) AS conversations
         FROM conversations
        WHERE archived = 0 OR archived IS NULL`,
    );
    return {
      unreadMessages: Number(row?.total ?? 0),
      unreadConversations: Number(row?.conversations ?? 0),
    };
  }

  async getAdminConversation(user: AuthUser | undefined, id: string) {
    assertAuthUser(user);
    const row = await this.getConversationRow(id);
    if (!row) throw new NotFoundException('Conversation not found');

    if (row.unread_admin > 0) {
      await this.db.execute(
        'UPDATE conversations SET unread_admin = 0 WHERE id = ?',
        [id],
      );
      row.unread_admin = 0;
      this.gateway?.server?.emit('unread:changed', { scope: 'customer' });
    }

    let customerName: string | null = null;
    let orderRef: string | null = null;
    let orderType: string | null = null;
    let orderStatus: string | null = null;
    if (row.customer_id) {
      const c = await this.db.queryOne<{ name: string | null }>(
        'SELECT name FROM customers WHERE id = ? LIMIT 1',
        [row.customer_id],
      );
      customerName = c?.name ?? null;
    }
    if (row.order_id) {
      const o = await this.db.queryOne<{
        human_ref: string | null;
        type: string | null;
        status: string | null;
      }>(
        'SELECT human_ref, type, status FROM orders WHERE id = ? LIMIT 1',
        [row.order_id],
      );
      orderRef = o?.human_ref ?? null;
      orderType = o?.type ?? null;
      orderStatus = o?.status ?? null;
    }

    return {
      ...this.conversationDto(row),
      customerName,
      orderRef,
      orderType,
      orderStatus,
      messages: await this.getMessages(id),
    };
  }

  async getCustomerMessagingContext(
    user: AuthUser | undefined,
    customerId: string,
  ) {
    assertAuthUser(user);
    const customer = await this.db.queryOne<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      account_type: string | null;
      created_at: Date;
      since_date: Date | null;
      preferences: unknown;
      internal_notes?: string | null;
    }>(
      `SELECT id, name, email, phone, account_type, created_at, since_date, preferences
         FROM customers WHERE id = ? LIMIT 1`,
      [customerId],
    );
    if (!customer) throw new NotFoundException('Customer not found');

    const stats = await this.db.queryOne<{
      total_orders: number;
      total_spent: number;
      last_order_at: Date | null;
    }>(
      `SELECT COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN type = 'ORDER' THEN COALESCE(price_cents, 0) ELSE 0 END), 0) AS total_spent,
              MAX(created_at) AS last_order_at
         FROM orders WHERE customer_id = ?`,
      [customerId],
    );

    const lastContact = await this.db.queryOne<{ last_at: Date | null }>(
      `SELECT MAX(last_message_at) AS last_at FROM conversations WHERE customer_id = ?`,
      [customerId],
    );

    const recentOrders = await this.db.query<{
      id: string;
      human_ref: string | null;
      status: string;
      price_cents: number | null;
      created_at: Date;
    }>(
      `SELECT id, human_ref, status, price_cents, created_at
         FROM orders
        WHERE customer_id = ? AND type = 'ORDER'
        ORDER BY created_at DESC LIMIT 8`,
      [customerId],
    );

    const recentQuotes = await this.db.query<{
      id: string;
      human_ref: string | null;
      status: string;
      price_cents: number | null;
      created_at: Date;
    }>(
      `SELECT id, human_ref, status, price_cents, created_at
         FROM orders
        WHERE customer_id = ? AND type = 'QUOTE_REQUEST'
        ORDER BY created_at DESC LIMIT 8`,
      [customerId],
    );

    const conversations = await this.listAdminConversations(user, {
      customerId,
      archived: false,
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        accountType: customer.account_type,
        createdAt: customer.created_at,
        customerSince: customer.since_date ?? customer.created_at,
        notes: null as string | null,
        preferredBranch: null as string | null,
        assignedSalesperson: null as string | null,
        totalOrders: Number(stats?.total_orders ?? 0),
        totalSpentCents: Number(stats?.total_spent ?? 0),
        lastOrderAt: stats?.last_order_at ?? null,
        lastContactAt: lastContact?.last_at ?? null,
      },
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        humanRef: o.human_ref,
        status: o.status,
        totalCents: o.price_cents,
        createdAt: o.created_at,
      })),
      recentQuotes: recentQuotes.map((o) => ({
        id: o.id,
        humanRef: o.human_ref,
        status: o.status,
        totalCents: o.price_cents,
        createdAt: o.created_at,
      })),
      conversations,
    };
  }

  async createAdminConversation(
    user: AuthUser | undefined,
    input: {
      customerId?: string | null;
      orderId?: string | null;
      subject?: string | null;
      label?: MessageLabel | null;
      chatType?: ChatType;
    },
  ) {
    assertAuthUser(user);

    let customerId = input.customerId ?? null;
    let orderRef: string | null = null;
    let orderType: string | null = null;
    if (input.orderId) {
      const order = await this.db.queryOne<{
        customer_id: string | null;
        human_ref: string | null;
        type: string;
      }>(
        'SELECT customer_id, human_ref, type FROM orders WHERE id = ? LIMIT 1',
        [input.orderId],
      );
      if (!order) throw new NotFoundException('Order not found');
      if (!customerId) customerId = order.customer_id;
      orderRef = order.human_ref;
      orderType = order.type;
    }

    const chatType = await this.resolveChatType(
      input.chatType ??
        (orderType === OrderType.QUOTE_REQUEST
          ? ChatType.QUOTE
          : input.orderId
            ? ChatType.ORDER
            : ChatType.GENERAL),
      input.orderId ?? null,
    );

    if (
      (chatType === ChatType.ORDER || chatType === ChatType.QUOTE) &&
      !input.orderId
    ) {
      throw new BadRequestException('orderId is required for order/quote chats');
    }
    if (chatType === ChatType.GENERAL && input.orderId) {
      // allow but treat as general without requiring uniqueness
    }

    if (
      customerId &&
      input.orderId &&
      (chatType === ChatType.ORDER || chatType === ChatType.QUOTE)
    ) {
      const existing = await this.findOpenTypedChat(
        customerId,
        chatType,
        input.orderId,
      );
      if (existing) return this.conversationDto(existing);
    }

    const subject =
      input.subject?.trim() || this.defaultSubject(chatType, orderRef);
    const id = this.db.uuid();
    await this.db.execute(
      `INSERT INTO conversations
         (id, customer_id, order_id, chat_type, status, subject, label, source, last_message_at)
       VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, NOW())`,
      [
        id,
        customerId,
        input.orderId ?? null,
        chatType,
        subject,
        input.label ?? null,
        MessageSource.PORTAL,
      ],
    );
    const row = await this.getConversationRow(id);
    return this.conversationDto(row!);
  }

  async addAdminMessage(
    user: AuthUser | undefined,
    conversationId: string,
    body: string,
    files: UploadFile[] = [],
    replyToMessageId?: string | null,
  ) {
    assertAuthUser(user);
    const text = body.trim();
    if (!text && files.length === 0)
      throw new BadRequestException('Message body or attachment is required');

    const convo = await this.getConversationRow(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');
    if (convo.status === ConversationStatus.CLOSED) {
      throw new BadRequestException('Conversation is closed');
    }

    const messageId = this.db.uuid();
    await this.db.execute(
      `INSERT INTO messages
         (id, conversation_id, sender_user_id, direction, body, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        conversationId,
        user.id,
        MessageDirection.OUTBOUND,
        text || '(attachment)',
        replyToMessageId ?? null,
      ],
    );
    const attachments = await this.saveAttachments(messageId, files);
    await this.adoptSubjectFromFirstMessage(convo, text || '(attachment)');
    await this.db.execute(
      'UPDATE conversations SET last_message_at = NOW(), unread_client = unread_client + 1, status = ? WHERE id = ?',
      [ConversationStatus.OPEN, conversationId],
    );

    if (convo.customer_id) {
      const cust = await this.db.queryOne<{ user_id: string | null }>(
        'SELECT user_id FROM customers WHERE id = ? LIMIT 1',
        [convo.customer_id],
      );
      if (cust?.user_id) {
        await this.notifications.createFor(cust.user_id, {
          title: 'New message from our team',
          body: (text || 'Sent an attachment').slice(0, 140),
          link: `/portal/messages?c=${conversationId}`,
        });
        this.gateway?.emitToUser(cust.user_id, 'message:new', {
          conversationId,
          direction: MessageDirection.OUTBOUND,
        });
      }
    }

    const row = await this.getConversationRow(conversationId);
    const message = await this.db.queryOne<MessageRow>(
      'SELECT * FROM messages WHERE id = ? LIMIT 1',
      [messageId],
    );
    const dto = {
      conversation: this.conversationDto(row!),
      message: this.messageDto(message!, attachments),
    };
    this.emitConversation('message:new', {
      conversationId,
      message: dto.message,
      conversation: dto.conversation,
    });
    return dto;
  }

  async updateAdminConversation(
    user: AuthUser | undefined,
    conversationId: string,
    input: {
      label?: MessageLabel | null;
      subject?: string | null;
      archived?: boolean;
      privateNotes?: string | null;
      status?: ConversationStatus;
    },
  ) {
    assertAuthUser(user);
    const convo = await this.getConversationRow(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.label !== undefined) {
      sets.push('label = ?');
      params.push(input.label ?? null);
    }
    if (input.subject !== undefined) {
      sets.push('subject = ?');
      params.push(input.subject?.trim() || null);
    }
    if (input.archived !== undefined) {
      sets.push('archived = ?');
      params.push(input.archived ? 1 : 0);
    }
    if (input.privateNotes !== undefined) {
      sets.push('private_notes = ?');
      params.push(input.privateNotes?.trim() || null);
    }
    if (input.status !== undefined) {
      sets.push('status = ?');
      params.push(input.status);
    }
    if (sets.length === 0) return this.conversationDto(convo);

    params.push(conversationId);
    await this.db.execute(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    const row = await this.getConversationRow(conversationId);
    const dto = this.conversationDto(row!);
    this.gateway?.emitToConversation(conversationId, 'conversation:updated', {
      conversation: dto,
    });
    return dto;
  }

  async softDeleteMessage(user: AuthUser | undefined, messageId: string) {
    assertAuthUser(user);
    const message = await this.db.queryOne<MessageRow>(
      'SELECT * FROM messages WHERE id = ? LIMIT 1',
      [messageId],
    );
    if (!message) throw new NotFoundException('Message not found');
    await this.db.execute(
      'UPDATE messages SET deleted_at = NOW() WHERE id = ?',
      [messageId],
    );
    this.gateway?.emitToConversation(message.conversation_id, 'message:deleted', {
      conversationId: message.conversation_id,
      messageId,
    });
    return { ok: true };
  }

  // --- templates -----------------------------------------------------------

  async listTemplates(user: AuthUser | undefined) {
    assertAuthUser(user);
    const rows = await this.db.query<TemplateRow>(
      'SELECT * FROM message_templates ORDER BY created_at DESC',
    );
    return rows.map((t) => this.templateDto(t));
  }

  async createTemplate(
    user: AuthUser | undefined,
    input: { title: string; body: string },
  ) {
    assertAuthUser(user);
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body)
      throw new BadRequestException('Title and body are required');

    const id = this.db.uuid();
    await this.db.execute(
      'INSERT INTO message_templates (id, title, body) VALUES (?, ?, ?)',
      [id, title, body],
    );
    const row = await this.db.queryOne<TemplateRow>(
      'SELECT * FROM message_templates WHERE id = ? LIMIT 1',
      [id],
    );
    return this.templateDto(row!);
  }

  async deleteTemplate(user: AuthUser | undefined, id: string) {
    assertAuthUser(user);
    await this.db.execute('DELETE FROM message_templates WHERE id = ?', [id]);
    return { ok: true };
  }

  // --- customer flows ------------------------------------------------------

  async listMyConversations(user: AuthUser | undefined) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();

    const customerId = await this.getCustomerIdForUser(user.id);
    if (!customerId) return [];

    const rows = await this.db.query<ConversationListRow>(
      `SELECT c.*,
              cust.name AS customer_name,
              cust.email AS customer_email,
              cust.phone AS customer_phone,
              o.human_ref AS order_ref,
              o.type AS order_type,
              o.status AS order_status,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_body
         FROM conversations c
         LEFT JOIN customers cust ON cust.id = c.customer_id
         LEFT JOIN orders o ON o.id = c.order_id
        WHERE c.customer_id = ?
        ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.created_at DESC`,
      [customerId],
    );
    return rows.map((r) => this.conversationListDto(r, true));
  }

  async myUnreadSummary(user: AuthUser | undefined) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const customerId = await this.getCustomerIdForUser(user.id);
    if (!customerId) {
      return { unreadMessages: 0, unreadConversations: 0 };
    }
    const row = await this.db.queryOne<{
      total: number;
      conversations: number;
    }>(
      `SELECT COALESCE(SUM(unread_client), 0) AS total,
              COALESCE(SUM(CASE WHEN unread_client > 0 THEN 1 ELSE 0 END), 0) AS conversations
         FROM conversations
        WHERE customer_id = ?`,
      [customerId],
    );
    return {
      unreadMessages: Number(row?.total ?? 0),
      unreadConversations: Number(row?.conversations ?? 0),
    };
  }

  private async getOwnedConversation(
    user: AuthUser,
    conversationId: string,
  ): Promise<{ convo: ConversationRow; customerId: string }> {
    const customerId = await this.getCustomerIdForUser(user.id);
    if (!customerId) throw new NotFoundException('Conversation not found');
    const convo = await this.getConversationRow(conversationId);
    if (!convo || convo.customer_id !== customerId)
      throw new NotFoundException('Conversation not found');
    return { convo, customerId };
  }

  async getMyConversation(user: AuthUser | undefined, id: string) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const { convo } = await this.getOwnedConversation(user, id);

    if (convo.unread_client > 0) {
      await this.db.execute(
        'UPDATE conversations SET unread_client = 0 WHERE id = ?',
        [id],
      );
      convo.unread_client = 0;
      this.gateway?.emitToUser(user.id, 'unread:changed', { scope: 'customer' });
    }

    let orderRef: string | null = null;
    let orderStatus: string | null = null;
    if (convo.order_id) {
      const o = await this.db.queryOne<{
        human_ref: string | null;
        status: string | null;
      }>('SELECT human_ref, status FROM orders WHERE id = ? LIMIT 1', [
        convo.order_id,
      ]);
      orderRef = o?.human_ref ?? null;
      orderStatus = o?.status ?? null;
    }

    return {
      ...this.conversationDto(convo, true),
      orderRef,
      orderStatus,
      messages: await this.getMessages(id),
    };
  }

  async createMyConversation(
    user: AuthUser | undefined,
    input: {
      subject?: string | null;
      orderId?: string | null;
      label?: MessageLabel | null;
      chatType?: ChatType;
    },
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();

    const customerId = await this.getCustomerIdForUser(user.id);
    if (!customerId)
      throw new BadRequestException(
        'No customer profile is linked to your account',
      );

    let orderId = input.orderId ?? null;
    let orderRef: string | null = null;
    let orderType: string | null = null;
    if (orderId) {
      const order = await this.db.queryOne<{
        customer_id: string | null;
        client_user_id: string | null;
        human_ref: string | null;
        type: string;
      }>(
        'SELECT customer_id, client_user_id, human_ref, type FROM orders WHERE id = ? LIMIT 1',
        [orderId],
      );
      if (
        !order ||
        (order.customer_id !== customerId && order.client_user_id !== user.id)
      ) {
        throw new NotFoundException('Order not found');
      }
      orderRef = order.human_ref;
      orderType = order.type;
    }

    const chatType = await this.resolveChatType(
      input.chatType ??
        (orderType === OrderType.QUOTE_REQUEST
          ? ChatType.QUOTE
          : orderId
            ? ChatType.ORDER
            : ChatType.GENERAL),
      orderId,
    );

    if (
      (chatType === ChatType.ORDER || chatType === ChatType.QUOTE) &&
      !orderId
    ) {
      throw new BadRequestException('orderId is required for order/quote chats');
    }

    if (orderId && (chatType === ChatType.ORDER || chatType === ChatType.QUOTE)) {
      const existing = await this.findOpenTypedChat(
        customerId,
        chatType,
        orderId,
      );
      if (existing) return this.conversationDto(existing, true);
    }

    const subject =
      input.subject?.trim() || this.defaultSubject(chatType, orderRef);
    const id = this.db.uuid();
    await this.db.execute(
      `INSERT INTO conversations
         (id, customer_id, order_id, chat_type, status, subject, label, source, last_message_at)
       VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, NOW())`,
      [
        id,
        customerId,
        orderId,
        chatType,
        subject,
        input.label ?? null,
        MessageSource.PORTAL,
      ],
    );
    const row = await this.getConversationRow(id);
    this.gateway?.server?.emit('conversation:updated', {
      conversation: this.conversationDto(row!, true),
    });
    return this.conversationDto(row!, true);
  }

  async addMyMessage(
    user: AuthUser | undefined,
    conversationId: string,
    body: string,
    files: UploadFile[] = [],
    replyToMessageId?: string | null,
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const text = body.trim();
    if (!text && files.length === 0)
      throw new BadRequestException('Message body or attachment is required');

    const { convo } = await this.getOwnedConversation(user, conversationId);
    if (convo.status === ConversationStatus.CLOSED) {
      throw new BadRequestException('Conversation is closed');
    }

    const messageId = this.db.uuid();
    await this.db.execute(
      `INSERT INTO messages
         (id, conversation_id, sender_user_id, direction, body, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        conversationId,
        user.id,
        MessageDirection.INBOUND,
        text || '(attachment)',
        replyToMessageId ?? null,
      ],
    );
    const attachments = await this.saveAttachments(messageId, files);
    await this.adoptSubjectFromFirstMessage(convo, text || '(attachment)');
    await this.db.execute(
      'UPDATE conversations SET last_message_at = NOW(), unread_admin = unread_admin + 1, status = ? WHERE id = ?',
      [ConversationStatus.OPEN, conversationId],
    );

    await this.notifications.createForMany(await this.staffUserIds(), {
      title: 'New customer message',
      body: (text || 'Sent an attachment').slice(0, 140),
      link: `/admin/messages/customers/${conversationId}`,
    });

    const row = await this.getConversationRow(conversationId);
    const message = await this.db.queryOne<MessageRow>(
      'SELECT * FROM messages WHERE id = ? LIMIT 1',
      [messageId],
    );
    const dto = {
      conversation: this.conversationDto(row!, true),
      message: this.messageDto(message!, attachments),
    };
    this.emitConversation('message:new', {
      conversationId,
      message: dto.message,
      conversation: dto.conversation,
    });
    this.gateway?.server?.emit('unread:changed', { scope: 'customer' });
    return dto;
  }
}
