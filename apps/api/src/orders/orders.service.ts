import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { hasSupportPerm } from '../auth/permissions';
import {
  AccountType,
  CustomerSource,
  DeliveredVia,
  DesignStatus,
  OrderStatus,
  OrderType,
  QuotationStatus,
  ServiceType,
  UserRole,
} from '../common/enums';
import { BillingService } from '../billing/billing.service';
import {
  normalizePage,
  pageResult,
  parseDateBound,
} from '../common/pagination';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LocalStorageService } from '../storage/local-storage.service';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

function isAdminRole(role: UserRole): boolean {
  return (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.ADMIN ||
    role === UserRole.SUPPORT ||
    role === UserRole.DESIGNER
  );
}

function toServiceType(value?: string | null): ServiceType | null {
  if (!value) return null;
  const upper = value.toUpperCase().replace(/[^A-Z]/g, '_');
  return (Object.values(ServiceType) as string[]).includes(upper)
    ? (upper as ServiceType)
    : null;
}

function formatLabelFromName(name: string): string | null {
  const base = name.trim();
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toUpperCase().slice(0, 60) || null;
}

type OrderRow = {
  id: string;
  human_ref: string | null;
  customer_id: string | null;
  client_user_id: string | null;
  type: OrderType;
  service_type: ServiceType | null;
  main_category: string | null;
  sub_category: string | null;
  name: string | null;
  instructions: string | null;
  size: string | null;
  preferences: unknown;
  status: OrderStatus;
  price_cents: number | null;
  currency: string;
  assigned_designer_id: string | null;
  parent_order_id: string | null;
  due_date: Date | null;
  internal_notes: string | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

type QuotationRow = {
  id: string;
  order_id: string;
  version: number;
  status: QuotationStatus;
  created_by_role: UserRole;
  created_by_id: string | null;
  amount_cents: number | null;
  currency: string;
  comment: string | null;
  created_at: Date;
};

type DesignRow = {
  id: string;
  order_id: string;
  name: string;
  placement: string | null;
  size: string | null;
  status: DesignStatus;
  price_cents: number | null;
  requested_formats: unknown;
  sort_order: number;
  created_at: Date;
};

type QuotationLineRow = {
  id: string;
  quotation_id: string;
  name: string;
  note: string | null;
  price_cents: number | null;
  sort_order: number;
  client_decision?: string | null;
};

type QuotationLineSizeRow = {
  id: string;
  line_id: string;
  label: string;
  price_cents: number;
  sort_order: number;
};

@Injectable()
export class OrdersService {
  constructor(
    private db: DbService,
    private storage: LocalStorageService,
    private notifications: NotificationsService,
    private billing: BillingService,
  ) {}

  // --- mapping helpers -----------------------------------------------------

  private orderDto(o: OrderRow) {
    return {
      id: o.id,
      humanRef: o.human_ref,
      customerId: o.customer_id,
      clientId: o.client_user_id,
      type: o.type,
      serviceType: o.service_type,
      mainCategory: o.main_category,
      subCategory: o.sub_category,
      name: o.name,
      instructions: o.instructions,
      size: o.size,
      preferences: o.preferences ?? null,
      status: o.status,
      priceCents: o.price_cents,
      currency: o.currency,
      assignedDesignerId: o.assigned_designer_id,
      parentOrderId: o.parent_order_id,
      dueDate: o.due_date,
      internalNotes: o.internal_notes,
      rejectionReason: o.rejection_reason,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    };
  }

  private quotationDto(q: QuotationRow) {
    return {
      id: q.id,
      orderId: q.order_id,
      version: q.version,
      status: q.status,
      createdByRole: q.created_by_role,
      createdById: q.created_by_id,
      amountCents: q.amount_cents,
      currency: q.currency,
      comment: q.comment,
      createdAt: q.created_at,
    };
  }

  private designDto(d: DesignRow) {
    return {
      id: d.id,
      orderId: d.order_id,
      name: d.name,
      placement: d.placement,
      size: d.size,
      status: d.status,
      priceCents: d.price_cents,
      requestedFormats: d.requested_formats ?? null,
      sortOrder: d.sort_order,
      createdAt: d.created_at,
    };
  }

  private async getOrderRow(id: string): Promise<OrderRow | null> {
    return this.db.queryOne<OrderRow>(
      'SELECT * FROM orders WHERE id = ? LIMIT 1',
      [id],
    );
  }

  private async getAttachments(orderId: string) {
    const rows = await this.db.query<{
      id: string;
      order_id: string;
      original_name: string;
      mime_type: string | null;
      byte_size: number | null;
      storage_key: string;
      created_at: Date;
    }>(
      'SELECT id, order_id, original_name, mime_type, byte_size, storage_key, created_at FROM order_attachments WHERE order_id = ? ORDER BY created_at ASC',
      [orderId],
    );
    return rows.map((a) => ({
      id: a.id,
      orderId: a.order_id,
      originalName: a.original_name,
      mimeType: a.mime_type,
      byteSize: a.byte_size,
      createdAt: a.created_at,
    }));
  }

  private async getQuotationLines(quotationId: string) {
    const lines = await this.db.query<QuotationLineRow>(
      `SELECT id, quotation_id, name, note, price_cents, sort_order,
              COALESCE(client_decision, 'PENDING') AS client_decision
         FROM quotation_lines WHERE quotation_id = ? ORDER BY sort_order ASC`,
      [quotationId],
    );
    const out = [];
    for (const l of lines) {
      const sizes = await this.db.query<QuotationLineSizeRow>(
        'SELECT id, line_id, label, price_cents, sort_order FROM quotation_line_sizes WHERE line_id = ? ORDER BY sort_order ASC',
        [l.id],
      );
      out.push({
        id: l.id,
        name: l.name,
        note: l.note,
        priceCents: l.price_cents,
        sortOrder: l.sort_order,
        clientDecision: l.client_decision ?? 'PENDING',
        sizes: sizes.map((s) => ({
          id: s.id,
          label: s.label,
          priceCents: s.price_cents,
          sortOrder: s.sort_order,
        })),
      });
    }
    return out;
  }

  private async getQuotations(orderId: string) {
    const rows = await this.db.query<QuotationRow>(
      'SELECT * FROM quotations WHERE order_id = ? ORDER BY version DESC',
      [orderId],
    );
    const out = [];
    for (const q of rows) {
      out.push({
        ...this.quotationDto(q),
        lines: await this.getQuotationLines(q.id),
      });
    }
    return out;
  }

  private async getDesigns(orderId: string) {
    const rows = await this.db.query<DesignRow>(
      'SELECT * FROM order_designs WHERE order_id = ? ORDER BY sort_order ASC, created_at ASC',
      [orderId],
    );
    return rows.map((d) => this.designDto(d));
  }

  private async getLatestQuotation(orderId: string): Promise<QuotationRow | null> {
    return this.db.queryOne<QuotationRow>(
      'SELECT * FROM quotations WHERE order_id = ? ORDER BY version DESC LIMIT 1',
      [orderId],
    );
  }

  private async getDeliveries(orderId: string) {
    const deliveries = await this.db.query<{
      id: string;
      order_id: string;
      version: number;
      delivered_via: string;
      created_at: Date;
    }>(
      'SELECT id, order_id, version, delivered_via, created_at FROM deliveries WHERE order_id = ? ORDER BY version DESC',
      [orderId],
    );
    const out = [];
    for (const d of deliveries) {
      const files = await this.db.query<{
        id: string;
        original_name: string;
        mime_type: string | null;
        byte_size: number | null;
        format_label: string | null;
        created_at: Date;
      }>(
        'SELECT id, original_name, mime_type, byte_size, format_label, created_at FROM delivery_files WHERE delivery_id = ? ORDER BY created_at ASC',
        [d.id],
      );
      out.push({
        id: d.id,
        orderId: d.order_id,
        version: d.version,
        deliveredVia: d.delivered_via,
        createdAt: d.created_at,
        files: files.map((f) => ({
          id: f.id,
          originalName: f.original_name,
          mimeType: f.mime_type,
          byteSize: f.byte_size,
          formatLabel: f.format_label,
          createdAt: f.created_at,
        })),
      });
    }
    return out;
  }

  private async adminUserIds(): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      "SELECT id FROM users WHERE role IN ('SUPER_ADMIN','ADMIN')",
    );
    return rows.map((r) => r.id);
  }

  private async notifyAdmins(input: {
    title: string;
    body?: string | null;
    link?: string | null;
  }) {
    await this.notifications.createForMany(await this.adminUserIds(), input);
  }

  // --- client flows --------------------------------------------------------

  async createOrder(
    client: AuthUser | undefined,
    data: {
      type?: string | null;
      name?: string | null;
      mainCategory?: string | null;
      subCategory?: string | null;
      serviceType: string;
      instructions?: string | null;
      size?: string | null;
      preferences?: unknown;
    },
  ) {
    assertAuthUser(client);
    if (client.role !== UserRole.CLIENT) throw new ForbiddenException();

    const type =
      data.type === OrderType.QUOTE_REQUEST ||
      data.type === 'QUOTATION_REQUEST'
        ? OrderType.QUOTE_REQUEST
        : OrderType.ORDER;

    let customer = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM customers WHERE user_id = ? LIMIT 1',
      [client.id],
    );
    if (!customer) {
      const user = await this.db.queryOne<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
      }>(
        'SELECT email, first_name, last_name, phone FROM users WHERE id = ? LIMIT 1',
        [client.id],
      );
      const customerId = randomUUID();
      const displayName =
        [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
        user?.email ||
        'Customer';
      await this.db.execute(
        `INSERT INTO customers
           (id, user_id, name, email, phone, account_type, source, since_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`,
        [
          customerId,
          client.id,
          displayName,
          user?.email ?? null,
          user?.phone ?? null,
          AccountType.PAY_PER_ORDER,
          CustomerSource.PORTAL,
        ],
      );
      customer = { id: customerId };
    }

    const id = randomUUID();
    const name =
      data.name?.trim() ||
      data.subCategory ||
      data.mainCategory ||
      data.serviceType;
    await this.db.execute(
      `INSERT INTO orders
         (id, customer_id, client_user_id, type, service_type, main_category, sub_category, name, instructions, size, preferences, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        customer.id,
        client.id,
        type,
        toServiceType(data.serviceType),
        data.mainCategory ?? null,
        data.subCategory ?? null,
        name,
        data.instructions ?? null,
        data.size ?? null,
        data.preferences ? JSON.stringify(data.preferences) : null,
        OrderStatus.WAITING_FOR_QUOTATION,
      ],
    );

    await this.notifyAdmins({
      title: 'New order received',
      body: `Client is waiting for quotation - ${name}`,
      link: `/admin/orders/${id}`,
    });

    return this.assembleOrder(id);
  }

  private async assembleOrder(id: string) {
    const row = await this.getOrderRow(id);
    if (!row) throw new NotFoundException('Order not found');
    return {
      ...this.orderDto(row),
      designs: await this.getDesigns(id),
      attachments: await this.getAttachments(id),
      quotations: await this.getQuotations(id),
      deliveries: await this.getDeliveries(id),
    };
  }

  async listMyOrders(user: AuthUser | undefined) {
    assertAuthUser(user);
    const rows = await this.db.query<OrderRow>(
      'SELECT * FROM orders WHERE client_user_id = ? ORDER BY created_at DESC',
      [user.id],
    );
    const out = [];
    for (const r of rows) {
      out.push({
        ...this.orderDto(r),
        attachments: await this.getAttachments(r.id),
        quotations: await this.getQuotations(r.id),
      });
    }
    return out;
  }

  async getMyOrder(user: AuthUser | undefined, orderId: string) {
    assertAuthUser(user);
    const row = await this.getOrderRow(orderId);
    if (!row || row.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    return this.assembleOrder(orderId);
  }

  private async persistOrderAttachments(
    orderId: string,
    user: AuthUser,
    files: Express.Multer.File[],
  ) {
    const out = [];
    for (const f of files) {
      const key = this.storage.newObjectKey(
        ['orders', orderId, 'attachments'],
        f.originalname,
      );
      await this.storage.uploadObject({
        key,
        body: f.buffer,
        contentType: f.mimetype,
      });
      const id = randomUUID();
      await this.db.execute(
        `INSERT INTO order_attachments
           (id, order_id, uploaded_by_role, uploaded_by_id, original_name, mime_type, byte_size, storage_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orderId,
          user.role,
          user.id,
          f.originalname,
          f.mimetype || null,
          typeof f.size === 'number' ? f.size : null,
          key,
        ],
      );
      out.push({ id, orderId, originalName: f.originalname });
    }
    return out;
  }

  async uploadOrderAttachments(
    user: AuthUser | undefined,
    orderId: string,
    files: Express.Multer.File[],
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    if (!files || files.length === 0)
      throw new BadRequestException('No files uploaded');

    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');

    const canUpload =
      order.status === OrderStatus.WAITING_FOR_QUOTATION ||
      order.status === OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL ||
      order.status === OrderStatus.QUOTATION_PROVIDED;
    if (!canUpload) {
      throw new BadRequestException(
        'Attachments can only be uploaded before the order starts (quotation stage).',
      );
    }

    return this.persistOrderAttachments(orderId, user, files);
  }

  async adminUploadOrderAttachments(
    user: AuthUser | undefined,
    orderId: string,
    files: Express.Multer.File[],
  ) {
    this.assertAdmin(user);
    if (!files || files.length === 0)
      throw new BadRequestException('No files uploaded');

    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const blocked =
      order.status === OrderStatus.CLOSED ||
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED;
    if (blocked) {
      throw new BadRequestException(
        'Attachments cannot be uploaded on closed, cancelled, or refunded orders.',
      );
    }

    return this.persistOrderAttachments(orderId, user, files);
  }

  private async signAttachment(orderId: string, attachmentId: string) {
    const att = await this.db.queryOne<{
      storage_key: string;
      original_name: string;
    }>(
      'SELECT storage_key, original_name FROM order_attachments WHERE id = ? AND order_id = ? LIMIT 1',
      [attachmentId, orderId],
    );
    if (!att) throw new NotFoundException('Attachment not found');
    const url = await this.storage.createSignedUrl({
      key: att.storage_key,
      downloadAs: att.original_name || 'attachment',
    });
    return { url };
  }

  private async signDeliveryFile(orderId: string, deliveryFileId: string) {
    const file = await this.db.queryOne<{
      storage_key: string;
      original_name: string;
    }>(
      `SELECT df.storage_key, df.original_name
         FROM delivery_files df
         JOIN deliveries d ON d.id = df.delivery_id
        WHERE df.id = ? AND d.order_id = ? LIMIT 1`,
      [deliveryFileId, orderId],
    );
    if (!file) throw new NotFoundException('Delivery file not found');
    const url = await this.storage.createSignedUrl({
      key: file.storage_key,
      downloadAs: file.original_name || 'delivery',
    });
    return { url };
  }

  async getMyAttachmentSignedUrl(
    user: AuthUser | undefined,
    orderId: string,
    attachmentId: string,
  ) {
    assertAuthUser(user);
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    return this.signAttachment(orderId, attachmentId);
  }

  async getMyDeliveryFileSignedUrl(
    user: AuthUser | undefined,
    orderId: string,
    deliveryFileId: string,
  ) {
    assertAuthUser(user);
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    return this.signDeliveryFile(orderId, deliveryFileId);
  }

  async clientAcceptQuotation(
    user: AuthUser | undefined,
    orderId: string,
    input?: { keepLineIds?: string[] | null },
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    const latest = await this.getLatestQuotation(orderId);
    if (!latest || latest.status === QuotationStatus.REJECTED)
      throw new BadRequestException('No active quotation to accept');
    if (order.status !== OrderStatus.QUOTATION_PROVIDED)
      throw new BadRequestException('Order is not awaiting client decision');

    const lines = await this.getQuotationLines(latest.id);
    const keepIds =
      input?.keepLineIds && input.keepLineIds.length > 0
        ? new Set(input.keepLineIds)
        : new Set(lines.map((l) => l.id));

    if (lines.length > 0 && keepIds.size === 0) {
      throw new BadRequestException('Keep at least one line to approve');
    }

    let totalCents = 0;
    for (const line of lines) {
      const kept = keepIds.has(line.id);
      await this.db.execute(
        'UPDATE quotation_lines SET client_decision = ? WHERE id = ?',
        [kept ? 'KEPT' : 'DROPPED', line.id],
      );
      if (kept) {
        const sizesTotal = line.sizes.reduce(
          (sum, s) => sum + (s.priceCents ?? 0),
          0,
        );
        totalCents += (line.priceCents ?? 0) + sizesTotal;
      }
    }

    if (lines.length > 0) {
      await this.db.execute(
        'UPDATE quotations SET status = ?, amount_cents = ? WHERE id = ?',
        [QuotationStatus.APPROVED, totalCents, latest.id],
      );
      await this.db.execute(
        'UPDATE orders SET status = ?, price_cents = ?, approved_at = NOW() WHERE id = ?',
        [OrderStatus.IN_PROGRESS, totalCents, orderId],
      );

      // Ensure designs exist for kept lines (admin production board).
      const existingDesigns = await this.getDesigns(orderId);
      if (existingDesigns.length === 0) {
        let sort = 0;
        for (const line of lines) {
          if (!keepIds.has(line.id)) continue;
          await this.db.execute(
            `INSERT INTO order_designs
               (id, order_id, name, placement, size, status, price_cents, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              randomUUID(),
              orderId,
              line.name,
              null,
              null,
              DesignStatus.WAITING,
              (line.priceCents ?? 0) +
                line.sizes.reduce((s, sz) => s + (sz.priceCents ?? 0), 0),
              sort++,
            ],
          );
        }
      }
    } else {
      await this.db.execute(
        'UPDATE quotations SET status = ? WHERE id = ?',
        [QuotationStatus.APPROVED, latest.id],
      );
      await this.db.execute(
        'UPDATE orders SET status = ?, approved_at = NOW() WHERE id = ?',
        [OrderStatus.IN_PROGRESS, orderId],
      );
    }

    await this.notifyAdmins({
      title: 'Quotation approved',
      body: `Order is now IN_PROGRESS - ${order.name ?? ''}`,
      link: `/admin/orders/${orderId}`,
    });
    return this.orderDto((await this.getOrderRow(orderId))!);
  }

  async clientRejectQuotation(
    user: AuthUser | undefined,
    orderId: string,
    input: { comment?: string | null },
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    const latest = await this.getLatestQuotation(orderId);
    if (!latest) throw new BadRequestException('No quotation to reject');
    if (order.status !== OrderStatus.QUOTATION_PROVIDED)
      throw new BadRequestException('Order is not awaiting client decision');

    await this.db.execute(
      'UPDATE quotations SET status = ?, comment = COALESCE(?, comment) WHERE id = ?',
      [QuotationStatus.REJECTED, input.comment?.trim() || null, latest.id],
    );
    await this.db.execute('UPDATE orders SET status = ? WHERE id = ?', [
      OrderStatus.CLIENT_REJECTED_QUOTATION,
      orderId,
    ]);
    return this.orderDto((await this.getOrderRow(orderId))!);
  }

  async clientCounterQuotation(
    user: AuthUser | undefined,
    orderId: string,
    input: { amountCents?: number | null; currency?: string | null; comment?: string | null },
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.QUOTATION_PROVIDED)
      throw new BadRequestException('Order is not awaiting client decision');

    const latest = await this.getLatestQuotation(orderId);
    const nextVersion = (latest?.version ?? 0) + 1;
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO quotations
         (id, order_id, version, status, created_by_role, created_by_id, amount_cents, currency, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        orderId,
        nextVersion,
        QuotationStatus.COUNTERED,
        UserRole.CLIENT,
        user.id,
        typeof input.amountCents === 'number' ? input.amountCents : null,
        (input.currency?.trim() || 'USD').toUpperCase(),
        input.comment?.trim() || null,
      ],
    );
    await this.db.execute('UPDATE orders SET status = ? WHERE id = ?', [
      OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL,
      orderId,
    ]);
    await this.notifyAdmins({
      title: 'Counter quotation submitted',
      body: `Client submitted a counter - ${order.name ?? ''}`,
      link: `/admin/orders/${orderId}`,
    });
    return this.quotationDto((await this.getLatestQuotation(orderId))!);
  }

  // --- admin flows ---------------------------------------------------------

  private assertAdmin(user: AuthUser | undefined): asserts user is AuthUser {
    assertAuthUser(user);
    if (!isAdminRole(user.role)) throw new ForbiddenException();
  }

  async listAdminOrders(
    user: AuthUser | undefined,
    filters: {
      status?: OrderStatus;
      clientId?: string;
      type?: OrderType;
      q?: string;
      dateFrom?: string | null;
      dateTo?: string | null;
      page?: number;
      pageSize?: number;
    },
  ) {
    this.assertAdmin(user);
    const { page, pageSize, offset } = normalizePage(filters);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      where.push('o.status = ?');
      params.push(filters.status);
    }
    if (filters.clientId) {
      where.push('o.client_user_id = ?');
      params.push(filters.clientId);
    }
    if (filters.type) {
      where.push('o.type = ?');
      params.push(filters.type);
    }
    if (filters.q) {
      where.push(
        `(o.name LIKE ? OR o.human_ref LIKE ? OR c.name LIKE ? OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`,
      );
      const like = `%${filters.q}%`;
      params.push(like, like, like, like, like, like);
    }
    const from = parseDateBound(filters.dateFrom);
    const to = parseDateBound(filters.dateTo);
    if (from) {
      where.push('DATE(o.created_at) >= ?');
      params.push(from);
    }
    if (to) {
      where.push('DATE(o.created_at) <= ?');
      params.push(to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await this.db.queryOne<{ n: number | string }>(
      `SELECT COUNT(*) AS n
         FROM orders o
         LEFT JOIN users u ON u.id = o.client_user_id
         LEFT JOIN customers c ON c.id = o.customer_id
         ${whereSql}`,
      params,
    );
    const rows = await this.db.query<
      OrderRow & {
        client_email: string | null;
        client_first: string | null;
        client_last: string | null;
        customer_name: string | null;
      }
    >(
      `SELECT o.*, u.email AS client_email, u.first_name AS client_first,
              u.last_name AS client_last, c.name AS customer_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.client_user_id
         LEFT JOIN customers c ON c.id = o.customer_id
         ${whereSql}
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const out = [];
    for (const r of rows) {
      out.push({
        ...this.orderDto(r),
        customerName: r.customer_name,
        client: r.client_user_id
          ? {
              id: r.client_user_id,
              email: r.client_email,
              firstName: r.client_first,
              lastName: r.client_last,
            }
          : null,
        attachments: await this.getAttachments(r.id),
        quotations: await this.getQuotations(r.id),
      });
    }
    return pageResult(out, Number(count?.n ?? 0), page, pageSize);
  }

  async duplicateOrder(
    user: AuthUser | undefined,
    input: { sourceOrderId: string; type?: OrderType },
  ) {
    this.assertAdmin(user);
    const source = await this.getOrderRow(input.sourceOrderId);
    if (!source) throw new NotFoundException('Order not found');

    const type = input.type ?? source.type;
    const id = randomUUID();
    const preferences =
      source.preferences != null
        ? typeof source.preferences === 'string'
          ? source.preferences
          : JSON.stringify(source.preferences)
        : null;

    await this.db.execute(
      `INSERT INTO orders
         (id, customer_id, client_user_id, type, service_type, main_category, sub_category, name, instructions, size, preferences, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        source.customer_id,
        source.client_user_id,
        type,
        source.service_type,
        source.main_category,
        source.sub_category,
        source.name,
        source.instructions,
        source.size,
        preferences,
        OrderStatus.WAITING_FOR_QUOTATION,
      ],
    );

    await this.notifyAdmins({
      title: 'Order duplicated',
      body: `Copied from ${source.name ?? source.human_ref ?? 'order'} — review and price as needed`,
      link: `/admin/orders/${id}`,
    });

    return this.assembleOrder(id);
  }

  async adminCreateOrder(
    user: AuthUser | undefined,
    data: {
      type: OrderType;
      customerId?: string | null;
      customerName?: string | null;
      email?: string | null;
      phone?: string | null;
      source?: CustomerSource | null;
      serviceType: string;
      size?: string | null;
      name?: string | null;
      designCount?: number | null;
      priceCents?: number | null;
      instructions?: string | null;
      channel?: string | null;
    },
  ) {
    this.assertAdmin(user);

    const customerName = data.customerName?.trim() || null;
    const email = data.email?.trim() || null;
    const phone = data.phone?.trim() || null;
    const source = data.source ?? CustomerSource.GUEST;

    let customerId: string | null = data.customerId?.trim() || null;
    let clientUserId: string | null = null;

    if (customerId) {
      const existing = await this.db.queryOne<{
        id: string;
        user_id: string | null;
      }>('SELECT id, user_id FROM customers WHERE id = ? LIMIT 1', [customerId]);
      if (!existing) throw new NotFoundException('Customer not found');
      clientUserId = existing.user_id;
    } else {
      if (!customerName) {
        throw new BadRequestException(
          'customerName is required when customerId is not provided',
        );
      }
      if (email) {
        const byEmail = await this.db.queryOne<{
          id: string;
          user_id: string | null;
        }>(
          'SELECT id, user_id FROM customers WHERE email = ? AND merged_into_id IS NULL LIMIT 1',
          [email],
        );
        if (byEmail) {
          customerId = byEmail.id;
          clientUserId = byEmail.user_id;
        }
      }
      if (!customerId) {
        customerId = randomUUID();
        await this.db.execute(
          `INSERT INTO customers
             (id, name, email, phone, account_type, source)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            customerName,
            email,
            phone,
            AccountType.PAY_PER_ORDER,
            source,
          ],
        );
      }
    }

    const id = randomUUID();
    const humanRef = `LVD-${Date.now().toString(36).toUpperCase()}`;
    const serviceType = toServiceType(data.serviceType);
    const name =
      data.name?.trim() ||
      data.serviceType ||
      (data.type === OrderType.QUOTE_REQUEST ? 'Quote request' : 'Order');
    const priceCents =
      typeof data.priceCents === 'number' && Number.isFinite(data.priceCents)
        ? Math.round(data.priceCents)
        : null;
    const designCount =
      typeof data.designCount === 'number' && data.designCount > 0
        ? Math.min(Math.floor(data.designCount), 50)
        : 0;

    let status: OrderStatus;
    if (data.type === OrderType.ORDER) {
      status =
        priceCents != null && priceCents > 0
          ? OrderStatus.PENDING_PAYMENT
          : OrderStatus.CREATED;
    } else {
      status =
        priceCents != null && priceCents > 0
          ? OrderStatus.QUOTATION_PROVIDED
          : OrderStatus.WAITING_FOR_QUOTATION;
    }

    await this.db.execute(
      `INSERT INTO orders
         (id, human_ref, customer_id, client_user_id, type, service_type, name, instructions, size, status, price_cents, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        humanRef,
        customerId,
        clientUserId,
        data.type,
        serviceType,
        name,
        data.instructions?.trim() || null,
        data.size?.trim() || null,
        status,
        priceCents,
        data.channel?.trim() || null,
      ],
    );

    if (designCount > 0) {
      for (let i = 0; i < designCount; i++) {
        const designName =
          designCount === 1 && data.name?.trim()
            ? data.name.trim()
            : `Design ${i + 1}`;
        await this.db.execute(
          `INSERT INTO order_designs
             (id, order_id, name, size, status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            id,
            designName,
            data.size?.trim() || null,
            DesignStatus.WAITING,
            i,
          ],
        );
      }
    }

    let payLinkUrl: string | null = null;
    let quoteUrl: string | null = null;

    if (
      data.type === OrderType.ORDER &&
      priceCents != null &&
      priceCents > 0 &&
      customerId
    ) {
      const invoice = await this.billing.createInvoice(user, {
        customerId,
        orderId: id,
        amountCents: priceCents,
        coversText: name,
      });
      const payLink = await this.billing.createPayLink(user, invoice.id);
      payLinkUrl = payLink.url;
    }

    if (data.type === OrderType.QUOTE_REQUEST) {
      quoteUrl = `/admin/quotes/${id}`;
      if (priceCents != null && priceCents > 0) {
        await this.db.execute(
          `INSERT INTO quotations
             (id, order_id, version, status, created_by_role, created_by_id, amount_cents, currency, comment)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            id,
            1,
            QuotationStatus.PROPOSED,
            user.role,
            user.id,
            priceCents,
            'USD',
            null,
          ],
        );
      }
    }

    const order = await this.assembleOrder(id);
    return { order, payLinkUrl, quoteUrl };
  }

  async updateStatus(
    user: AuthUser | undefined,
    orderId: string,
    status: OrderStatus,
  ) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    await this.db.execute('UPDATE orders SET status = ? WHERE id = ?', [
      status,
      orderId,
    ]);
    return this.getAdminOrder(user, orderId);
  }

  async resendFiles(user: AuthUser | undefined, orderId: string) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const deliveries = await this.getDeliveries(orderId);
    if (deliveries.length === 0) {
      throw new BadRequestException('No deliverables on this order yet');
    }

    if (order.client_user_id) {
      await this.notifications.createFor(order.client_user_id, {
        title: 'Your files are ready',
        body: `Your deliverables for ${order.name ?? 'your order'} are available in the portal.`,
        link: `/orders/${orderId}`,
      });
    }

    return { ok: true as const };
  }

  async getAdminOrder(user: AuthUser | undefined, orderId: string) {
    this.assertAdmin(user);
    const row = await this.getOrderRow(orderId);
    if (!row) throw new NotFoundException('Order not found');
    let client = null;
    if (row.client_user_id) {
      client = await this.db.queryOne<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
      }>(
        'SELECT id, email, first_name, last_name, phone FROM users WHERE id = ? LIMIT 1',
        [row.client_user_id],
      );
    }
    return {
      ...this.orderDto(row),
      client: client
        ? {
            id: client.id,
            email: client.email,
            firstName: client.first_name,
            lastName: client.last_name,
            phone: client.phone,
          }
        : null,
      designs: await this.getDesigns(orderId),
      attachments: await this.getAttachments(orderId),
      quotations: await this.getQuotations(orderId),
      deliveries: await this.getDeliveries(orderId),
    };
  }

  async adminProposeQuotation(
    user: AuthUser | undefined,
    orderId: string,
    input: { amountCents?: number | null; currency?: string | null; comment?: string | null },
  ) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (
      order.status !== OrderStatus.WAITING_FOR_QUOTATION &&
      order.status !== OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL
    ) {
      throw new BadRequestException(
        'Quotation can only be proposed when waiting for quotation',
      );
    }

    const latest = await this.getLatestQuotation(orderId);
    const nextVersion = (latest?.version ?? 0) + 1;
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO quotations
         (id, order_id, version, status, created_by_role, created_by_id, amount_cents, currency, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        orderId,
        nextVersion,
        QuotationStatus.PROPOSED,
        user.role,
        user.id,
        typeof input.amountCents === 'number' ? input.amountCents : null,
        (input.currency?.trim() || 'USD').toUpperCase(),
        input.comment?.trim() || null,
      ],
    );
    await this.db.execute('UPDATE orders SET status = ? WHERE id = ?', [
      OrderStatus.QUOTATION_PROVIDED,
      orderId,
    ]);
    if (order.client_user_id) {
      await this.notifications.createFor(order.client_user_id, {
        title: 'Quotation provided',
        body: `Review and approve the quotation - ${order.name ?? ''}`,
        link: `/orders/${orderId}`,
      });
    }
    return this.quotationDto((await this.getLatestQuotation(orderId))!);
  }

  async adminAcceptCounter(user: AuthUser | undefined, orderId: string) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    const latest = await this.getLatestQuotation(orderId);
    if (!latest || latest.status !== QuotationStatus.COUNTERED)
      throw new BadRequestException('No counter quotation to approve');
    if (order.status !== OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL)
      throw new BadRequestException('Order is not awaiting counter approval');

    await this.db.execute('UPDATE quotations SET status = ? WHERE id = ?', [
      QuotationStatus.APPROVED,
      latest.id,
    ]);
    await this.db.execute(
      'UPDATE orders SET status = ?, approved_at = NOW() WHERE id = ?',
      [OrderStatus.IN_PROGRESS, orderId],
    );
    if (order.client_user_id) {
      await this.notifications.createFor(order.client_user_id, {
        title: 'Counter quotation approved',
        body: 'Your counter was approved. The order is now IN_PROGRESS.',
        link: `/orders/${orderId}`,
      });
    }
    return this.orderDto((await this.getOrderRow(orderId))!);
  }

  async adminRejectCounter(
    user: AuthUser | undefined,
    orderId: string,
    input: { comment?: string | null },
  ) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    const latest = await this.getLatestQuotation(orderId);
    if (!latest || latest.status !== QuotationStatus.COUNTERED)
      throw new BadRequestException('No counter quotation to reject');
    if (order.status !== OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL)
      throw new BadRequestException('Order is not awaiting counter approval');

    await this.db.execute(
      'UPDATE quotations SET status = ?, comment = COALESCE(?, comment) WHERE id = ?',
      [QuotationStatus.REJECTED, input.comment?.trim() || null, latest.id],
    );
    await this.db.execute('UPDATE orders SET status = ? WHERE id = ?', [
      OrderStatus.CLIENT_REJECTED_QUOTATION,
      orderId,
    ]);
    if (order.client_user_id) {
      await this.notifications.createFor(order.client_user_id, {
        title: 'Counter quotation rejected',
        body: input.comment?.trim() || 'Admin rejected the counter quotation.',
        link: `/orders/${orderId}`,
      });
    }
    return this.orderDto((await this.getOrderRow(orderId))!);
  }

  async approveOrder(user: AuthUser | undefined, orderId: string) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.CREATED)
      throw new BadRequestException('Only CREATED orders can be approved');
    await this.db.execute(
      'UPDATE orders SET status = ?, approved_at = NOW(), rejection_reason = NULL, rejected_at = NULL WHERE id = ?',
      [OrderStatus.IN_PROGRESS, orderId],
    );
    return this.orderDto((await this.getOrderRow(orderId))!);
  }

  async rejectOrder(
    user: AuthUser | undefined,
    orderId: string,
    input: { reason: string; status?: 'REJECTED' | 'CANCELLED' },
  ) {
    this.assertAdmin(user);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Rejection reason is required');
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const rejectable: OrderStatus[] = [
      OrderStatus.WAITING_FOR_QUOTATION,
      OrderStatus.QUOTATION_PROVIDED,
      OrderStatus.WAITING_FOR_ADMIN_QUOTATION_APPROVAL,
      OrderStatus.CREATED,
      OrderStatus.CLIENT_REJECTED_QUOTATION,
    ];
    if (!rejectable.includes(order.status)) {
      throw new BadRequestException(
        'Order cannot be rejected in its current status',
      );
    }

    let nextStatus: OrderStatus;
    if (input.status === OrderStatus.CANCELLED || input.status === OrderStatus.REJECTED) {
      nextStatus = input.status;
    } else if (/expir/i.test(reason)) {
      nextStatus = OrderStatus.CANCELLED;
    } else {
      nextStatus = OrderStatus.REJECTED;
    }

    await this.db.execute(
      'UPDATE orders SET status = ?, rejection_reason = ?, rejected_at = NOW() WHERE id = ?',
      [nextStatus, reason, orderId],
    );
    return this.orderDto((await this.getOrderRow(orderId))!);
  }

  async updateInternalNotes(
    user: AuthUser | undefined,
    orderId: string,
    notes: string,
  ) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    await this.db.execute(
      'UPDATE orders SET internal_notes = ? WHERE id = ?',
      [notes, orderId],
    );
    return this.orderDto((await this.getOrderRow(orderId))!);
  }

  async deliverOrder(
    user: AuthUser | undefined,
    orderId: string,
    files: Express.Multer.File[],
    options?: {
      deliveredVia?: DeliveredVia;
      designIds?: string[];
      notifyEmail?: boolean;
      notifySms?: boolean;
      complete?: boolean;
    },
  ) {
    this.assertAdmin(user);
    if (!files || files.length === 0)
      throw new BadRequestException('No files uploaded');

    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (
      order.status !== OrderStatus.IN_PROGRESS &&
      order.status !== OrderStatus.READY_TO_SEND
    ) {
      throw new BadRequestException(
        'Deliveries can only be uploaded while order is IN_PROGRESS or READY_TO_SEND',
      );
    }
    if (
      user.role === UserRole.SUPPORT &&
      order.status === OrderStatus.READY_TO_SEND &&
      !hasSupportPerm(user.role, user.permissions, 'approve')
    ) {
      throw new ForbiddenException(
        'Support cannot release designer files without approve permission',
      );
    }

    const deliveredVia =
      options?.deliveredVia === DeliveredVia.EMAIL
        ? DeliveredVia.EMAIL
        : DeliveredVia.PORTAL;
    const designIds = (options?.designIds ?? []).filter(Boolean);
    const notifyEmail = options?.notifyEmail !== false;
    const notifySms = options?.notifySms !== false;
    const wantsComplete = options?.complete !== false;

    if (designIds.length) {
      for (const designId of designIds) {
        await this.db.execute(
          `UPDATE order_designs SET status = ?
            WHERE id = ? AND order_id = ?`,
          [DesignStatus.DELIVERED, designId, orderId],
        );
      }
    }

    const latest = await this.db.queryOne<{ version: number }>(
      'SELECT version FROM deliveries WHERE order_id = ? ORDER BY version DESC LIMIT 1',
      [orderId],
    );
    const nextVersion = (latest?.version ?? 0) + 1;
    const deliveryId = randomUUID();
    await this.db.execute(
      `INSERT INTO deliveries
         (id, order_id, version, delivered_via, created_by_admin_id)
       VALUES (?, ?, ?, ?, ?)`,
      [deliveryId, orderId, nextVersion, deliveredVia, user.id],
    );

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = this.storage.newObjectKey(
        ['orders', orderId, 'deliveries', String(nextVersion)],
        f.originalname,
      );
      await this.storage.uploadObject({
        key,
        body: f.buffer,
        contentType: f.mimetype,
      });
      const designId =
        designIds.length > 0 ? designIds[i % designIds.length] : null;
      await this.db.execute(
        `INSERT INTO delivery_files
           (id, delivery_id, design_id, format_label, original_name, mime_type, byte_size, storage_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          deliveryId,
          designId,
          formatLabelFromName(f.originalname),
          f.originalname,
          f.mimetype || null,
          typeof f.size === 'number' ? f.size : null,
          key,
        ],
      );
    }

    const designs = await this.getDesigns(orderId);
    const allDelivered =
      designs.length === 0 ||
      designs.every((d) => d.status === DesignStatus.DELIVERED);
    const partial = !allDelivered && designs.length > 0 && !wantsComplete;

    if (allDelivered || wantsComplete) {
      await this.db.execute(
        'UPDATE orders SET status = ?, completed_at = NOW() WHERE id = ?',
        [OrderStatus.COMPLETED, orderId],
      );
    } else {
      await this.db.execute('UPDATE orders SET status = ? WHERE id = ?', [
        OrderStatus.IN_PROGRESS,
        orderId,
      ]);
    }

    const shouldNotify = notifyEmail || notifySms;
    if (shouldNotify && order.client_user_id) {
      await this.notifications.createFor(order.client_user_id, {
        title: 'Order delivered',
        body: partial
          ? `Partial deliverables uploaded - v${nextVersion}`
          : `Deliverables uploaded - v${nextVersion}`,
        link: `/orders/${orderId}`,
      });
    }

    return {
      order: this.orderDto((await this.getOrderRow(orderId))!),
      delivery: (await this.getDeliveries(orderId)).find(
        (d) => d.id === deliveryId,
      ),
      partial,
    };
  }

  async getAdminAttachmentSignedUrl(
    user: AuthUser | undefined,
    orderId: string,
    attachmentId: string,
  ) {
    this.assertAdmin(user);
    return this.signAttachment(orderId, attachmentId);
  }

  async getAdminDeliveryFileSignedUrl(
    user: AuthUser | undefined,
    orderId: string,
    deliveryFileId: string,
  ) {
    this.assertAdmin(user);
    return this.signDeliveryFile(orderId, deliveryFileId);
  }

  // --- designs -------------------------------------------------------------

  async createDesign(
    user: AuthUser | undefined,
    orderId: string,
    input: {
      name: string;
      placement?: string | null;
      size?: string | null;
      priceCents?: number | null;
      requestedFormats?: string[] | null;
    },
  ) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const maxRow = await this.db.queryOne<{ max_sort: number | null }>(
      'SELECT MAX(sort_order) AS max_sort FROM order_designs WHERE order_id = ?',
      [orderId],
    );
    const nextSort = (maxRow?.max_sort ?? -1) + 1;
    const id = randomUUID();
    await this.db.execute(
      `INSERT INTO order_designs
         (id, order_id, name, placement, size, status, price_cents, requested_formats, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        orderId,
        input.name.trim(),
        input.placement?.trim() || null,
        input.size?.trim() || null,
        DesignStatus.WAITING,
        typeof input.priceCents === 'number' ? input.priceCents : null,
        input.requestedFormats && input.requestedFormats.length
          ? JSON.stringify(input.requestedFormats)
          : null,
        nextSort,
      ],
    );
    const row = await this.db.queryOne<DesignRow>(
      'SELECT * FROM order_designs WHERE id = ? LIMIT 1',
      [id],
    );
    return this.designDto(row!);
  }

  async updateDesign(
    user: AuthUser | undefined,
    orderId: string,
    designId: string,
    input: {
      name?: string | null;
      placement?: string | null;
      size?: string | null;
      status?: DesignStatus | null;
      priceCents?: number | null;
    },
  ) {
    this.assertAdmin(user);
    const design = await this.db.queryOne<DesignRow>(
      'SELECT * FROM order_designs WHERE id = ? AND order_id = ? LIMIT 1',
      [designId, orderId],
    );
    if (!design) throw new NotFoundException('Design not found');

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name != null) {
      sets.push('name = ?');
      params.push(input.name.trim());
    }
    if (input.placement !== undefined) {
      sets.push('placement = ?');
      params.push(input.placement?.trim() || null);
    }
    if (input.size !== undefined) {
      sets.push('size = ?');
      params.push(input.size?.trim() || null);
    }
    if (input.status != null) {
      sets.push('status = ?');
      params.push(input.status);
    }
    if (input.priceCents !== undefined) {
      sets.push('price_cents = ?');
      params.push(typeof input.priceCents === 'number' ? input.priceCents : null);
    }
    if (sets.length) {
      params.push(designId);
      await this.db.execute(
        `UPDATE order_designs SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    const row = await this.db.queryOne<DesignRow>(
      'SELECT * FROM order_designs WHERE id = ? LIMIT 1',
      [designId],
    );
    return this.designDto(row!);
  }

  async deleteDesign(
    user: AuthUser | undefined,
    orderId: string,
    designId: string,
  ) {
    this.assertAdmin(user);
    const design = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM order_designs WHERE id = ? AND order_id = ? LIMIT 1',
      [designId, orderId],
    );
    if (!design) throw new NotFoundException('Design not found');
    await this.db.execute('DELETE FROM order_designs WHERE id = ?', [designId]);
    return { ok: true };
  }

  // --- quote builder -------------------------------------------------------

  async submitQuoteBuilder(
    user: AuthUser | undefined,
    orderId: string,
    input: {
      comment?: string | null;
      lines: Array<{
        name: string;
        note?: string | null;
        priceCents?: number | null;
        sizes?: Array<{ label: string; priceCents: number }>;
      }>;
    },
  ) {
    this.assertAdmin(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (!input.lines || input.lines.length === 0)
      throw new BadRequestException('At least one line item is required');

    let total = 0;
    for (const line of input.lines) {
      total += typeof line.priceCents === 'number' ? line.priceCents : 0;
      for (const s of line.sizes ?? []) {
        total += typeof s.priceCents === 'number' ? s.priceCents : 0;
      }
    }

    const currency = order.currency || 'USD';

    const quotationId = await this.db.withTransaction(async (tx) => {
      const latest = await tx.queryOne<{ version: number }>(
        'SELECT version FROM quotations WHERE order_id = ? ORDER BY version DESC LIMIT 1',
        [orderId],
      );
      const nextVersion = (latest?.version ?? 0) + 1;
      const qId = randomUUID();
      await tx.execute(
        `INSERT INTO quotations
           (id, order_id, version, status, created_by_role, created_by_id, amount_cents, currency, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qId,
          orderId,
          nextVersion,
          QuotationStatus.PROPOSED,
          user.role,
          user.id,
          total,
          currency,
          input.comment?.trim() || null,
        ],
      );

      let lineSort = 0;
      for (const line of input.lines) {
        const lineId = randomUUID();
        await tx.execute(
          `INSERT INTO quotation_lines
             (id, quotation_id, name, note, price_cents, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            qId,
            line.name.trim(),
            line.note?.trim() || null,
            typeof line.priceCents === 'number' ? line.priceCents : null,
            lineSort++,
          ],
        );
        let sizeSort = 0;
        for (const s of line.sizes ?? []) {
          await tx.execute(
            `INSERT INTO quotation_line_sizes
               (id, line_id, label, price_cents, sort_order)
             VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), lineId, s.label.trim(), s.priceCents ?? 0, sizeSort++],
          );
        }
      }

      await tx.execute(
        'UPDATE orders SET status = ?, price_cents = ? WHERE id = ?',
        [OrderStatus.QUOTATION_PROVIDED, total, orderId],
      );

      if (order.client_user_id) {
        await tx.execute(
          'INSERT INTO notifications (id, user_id, title, body, link) VALUES (?, ?, ?, ?, ?)',
          [
            randomUUID(),
            order.client_user_id,
            'Quotation provided',
            `Review your quote - ${order.name ?? ''}`,
            `/portal/orders/${orderId}`,
          ],
        );
      }

      return qId;
    });

    const row = await this.db.queryOne<QuotationRow>(
      'SELECT * FROM quotations WHERE id = ? LIMIT 1',
      [quotationId],
    );
    return {
      ...this.quotationDto(row!),
      lines: await this.getQuotationLines(quotationId),
    };
  }

  // --- my files ------------------------------------------------------------

  async listMyFiles(user: AuthUser | undefined) {
    assertAuthUser(user);
    const rows = await this.db.query<{
      file_id: string;
      original_name: string;
      format_label: string | null;
      delivered_at: Date;
      order_id: string;
      order_name: string | null;
      human_ref: string | null;
    }>(
      `SELECT df.id AS file_id, df.original_name, df.format_label, df.created_at AS delivered_at,
              o.id AS order_id, o.name AS order_name, o.human_ref
         FROM delivery_files df
         JOIN deliveries d ON d.id = df.delivery_id
         JOIN orders o ON o.id = d.order_id
        WHERE o.client_user_id = ?
        ORDER BY df.created_at DESC`,
      [user.id],
    );
    return rows.map((r) => ({
      orderId: r.order_id,
      orderName: r.order_name,
      humanRef: r.human_ref,
      fileId: r.file_id,
      originalName: r.original_name,
      formatLabel: r.format_label,
      deliveredAt: r.delivered_at,
    }));
  }
}
