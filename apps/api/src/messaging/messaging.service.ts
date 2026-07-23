import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import {
  MessageDirection,
  MessageLabel,
  MessageSource,
  UserRole,
} from '../common/enums';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

type ConversationRow = {
  id: string;
  customer_id: string | null;
  order_id: string | null;
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
  order_ref: string | null;
  last_body: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  direction: MessageDirection;
  body: string;
  created_at: Date;
};

type TemplateRow = {
  id: string;
  title: string;
  body: string;
  created_at: Date;
};

const STAFF_NOTIFY_ROLES = "('SUPER_ADMIN','ADMIN','SUPPORT')";

@Injectable()
export class MessagingService {
  constructor(
    private db: DbService,
    private notifications: NotificationsService,
  ) {}

  // --- mapping helpers -----------------------------------------------------

  private conversationDto(c: ConversationRow) {
    return {
      id: c.id,
      customerId: c.customer_id,
      orderId: c.order_id,
      subject: c.subject,
      label: c.label,
      source: c.source,
      archived: Boolean(c.archived),
      privateNotes: c.private_notes,
      lastMessageAt: c.last_message_at,
      unreadAdmin: Number(c.unread_admin ?? 0),
      unreadClient: Number(c.unread_client ?? 0),
      createdAt: c.created_at,
    };
  }

  private conversationListDto(c: ConversationListRow) {
    return {
      ...this.conversationDto(c),
      customerName: c.customer_name,
      orderRef: c.order_ref,
      lastMessagePreview: c.last_body,
    };
  }

  private messageDto(m: MessageRow) {
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderUserId: m.sender_user_id,
      direction: m.direction,
      body: m.body,
      createdAt: m.created_at,
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

  private async getMessages(conversationId: string) {
    const rows = await this.db.query<MessageRow>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId],
    );
    return rows.map((m) => this.messageDto(m));
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

  // --- admin flows ---------------------------------------------------------

  async listAdminConversations(
    user: AuthUser | undefined,
    filters: { label?: string; q?: string; archived?: boolean },
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

    const q = filters.q?.trim();
    if (q) {
      const like = `%${q}%`;
      where.push(
        '(c.subject LIKE ? OR cust.name LIKE ? OR EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.body LIKE ?))',
      );
      params.push(like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<ConversationListRow>(
      `SELECT c.*,
              cust.name AS customer_name,
              o.human_ref AS order_ref,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
         FROM conversations c
         LEFT JOIN customers cust ON cust.id = c.customer_id
         LEFT JOIN orders o ON o.id = c.order_id
         ${whereSql}
         ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.created_at DESC`,
      params,
    );
    return rows.map((r) => this.conversationListDto(r));
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
    }

    let customerName: string | null = null;
    let orderRef: string | null = null;
    if (row.customer_id) {
      const c = await this.db.queryOne<{ name: string | null }>(
        'SELECT name FROM customers WHERE id = ? LIMIT 1',
        [row.customer_id],
      );
      customerName = c?.name ?? null;
    }
    if (row.order_id) {
      const o = await this.db.queryOne<{ human_ref: string | null }>(
        'SELECT human_ref FROM orders WHERE id = ? LIMIT 1',
        [row.order_id],
      );
      orderRef = o?.human_ref ?? null;
    }

    return {
      ...this.conversationDto(row),
      customerName,
      orderRef,
      messages: await this.getMessages(id),
    };
  }

  async createAdminConversation(
    user: AuthUser | undefined,
    input: {
      customerId?: string | null;
      orderId?: string | null;
      subject?: string | null;
      label?: MessageLabel | null;
    },
  ) {
    assertAuthUser(user);

    let customerId = input.customerId ?? null;
    // If an order is supplied but no customer, resolve the order's customer.
    if (input.orderId) {
      const order = await this.db.queryOne<{ customer_id: string | null }>(
        'SELECT customer_id FROM orders WHERE id = ? LIMIT 1',
        [input.orderId],
      );
      if (!order) throw new NotFoundException('Order not found');
      if (!customerId) customerId = order.customer_id;
    }

    const id = this.db.uuid();
    await this.db.execute(
      `INSERT INTO conversations
         (id, customer_id, order_id, subject, label, source, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        customerId,
        input.orderId ?? null,
        input.subject?.trim() || null,
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
  ) {
    assertAuthUser(user);
    const text = body.trim();
    if (!text) throw new BadRequestException('Message body is required');

    const convo = await this.getConversationRow(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');

    const messageId = this.db.uuid();
    await this.db.execute(
      `INSERT INTO messages (id, conversation_id, sender_user_id, direction, body)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, conversationId, user.id, MessageDirection.OUTBOUND, text],
    );
    await this.db.execute(
      'UPDATE conversations SET last_message_at = NOW(), unread_client = unread_client + 1 WHERE id = ?',
      [conversationId],
    );

    // Notify the customer's login user, if present.
    if (convo.customer_id) {
      const cust = await this.db.queryOne<{ user_id: string | null }>(
        'SELECT user_id FROM customers WHERE id = ? LIMIT 1',
        [convo.customer_id],
      );
      if (cust?.user_id) {
        await this.notifications.createFor(cust.user_id, {
          title: 'New message from our team',
          body: text.slice(0, 140),
          link: '/portal/messages',
        });
      }
    }

    const row = await this.getConversationRow(conversationId);
    const message = await this.db.queryOne<MessageRow>(
      'SELECT * FROM messages WHERE id = ? LIMIT 1',
      [messageId],
    );
    return {
      conversation: this.conversationDto(row!),
      message: this.messageDto(message!),
    };
  }

  async updateAdminConversation(
    user: AuthUser | undefined,
    conversationId: string,
    input: {
      label?: MessageLabel | null;
      subject?: string | null;
      archived?: boolean;
      privateNotes?: string | null;
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
    if (sets.length === 0) return this.conversationDto(convo);

    params.push(conversationId);
    await this.db.execute(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    const row = await this.getConversationRow(conversationId);
    return this.conversationDto(row!);
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
              o.human_ref AS order_ref,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
         FROM conversations c
         LEFT JOIN customers cust ON cust.id = c.customer_id
         LEFT JOIN orders o ON o.id = c.order_id
        WHERE c.customer_id = ?
        ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.created_at DESC`,
      [customerId],
    );
    return rows.map((r) => this.conversationListDto(r));
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
    }

    return {
      ...this.conversationDto(convo),
      messages: await this.getMessages(id),
    };
  }

  async createMyConversation(
    user: AuthUser | undefined,
    input: {
      subject?: string | null;
      orderId?: string | null;
      label?: MessageLabel | null;
    },
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();

    const customerId = await this.getCustomerIdForUser(user.id);
    if (!customerId)
      throw new BadRequestException('No customer profile is linked to your account');

    let orderId = input.orderId ?? null;
    if (orderId) {
      const order = await this.db.queryOne<{
        customer_id: string | null;
        client_user_id: string | null;
      }>(
        'SELECT customer_id, client_user_id FROM orders WHERE id = ? LIMIT 1',
        [orderId],
      );
      if (
        !order ||
        (order.customer_id !== customerId && order.client_user_id !== user.id)
      ) {
        throw new NotFoundException('Order not found');
      }
    }

    const id = this.db.uuid();
    await this.db.execute(
      `INSERT INTO conversations
         (id, customer_id, order_id, subject, label, source, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        customerId,
        orderId,
        input.subject?.trim() || null,
        input.label ?? null,
        MessageSource.PORTAL,
      ],
    );
    const row = await this.getConversationRow(id);
    return this.conversationDto(row!);
  }

  async addMyMessage(
    user: AuthUser | undefined,
    conversationId: string,
    body: string,
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const text = body.trim();
    if (!text) throw new BadRequestException('Message body is required');

    const { convo } = await this.getOwnedConversation(user, conversationId);

    const messageId = this.db.uuid();
    await this.db.execute(
      `INSERT INTO messages (id, conversation_id, sender_user_id, direction, body)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, conversationId, user.id, MessageDirection.INBOUND, text],
    );
    await this.db.execute(
      'UPDATE conversations SET last_message_at = NOW(), unread_admin = unread_admin + 1 WHERE id = ?',
      [conversationId],
    );

    await this.notifications.createForMany(await this.staffUserIds(), {
      title: 'New customer message',
      body: text.slice(0, 140),
      link: '/admin/messages',
    });

    const row = await this.getConversationRow(conversationId);
    const message = await this.db.queryOne<MessageRow>(
      'SELECT * FROM messages WHERE id = ? LIMIT 1',
      [messageId],
    );
    void convo;
    return {
      conversation: this.conversationDto(row!),
      message: this.messageDto(message!),
    };
  }
}
