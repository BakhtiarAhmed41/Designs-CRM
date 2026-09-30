import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import {
  DesignStatus,
  EditKind,
  EditStatus,
  InvoiceStatus,
  OrderStatus,
  UserRole,
} from '../common/enums';
import { normalizePage, pageResult } from '../common/pagination';
import { DbService } from '../db/db.service';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

function isStaffRole(role: UserRole): boolean {
  return (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.ADMIN ||
    role === UserRole.SUPPORT ||
    role === UserRole.DESIGNER
  );
}

/** Anything with an `execute` helper (DbService or a DbTransaction). */
type SqlRunner = {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
};

type OrderRow = {
  id: string;
  human_ref: string | null;
  customer_id: string | null;
  client_user_id: string | null;
  service_type: string | null;
  name: string | null;
  status: OrderStatus;
  price_cents: number | null;
  currency: string;
};

type EditRow = {
  id: string;
  order_id: string;
  design_id: string | null;
  design_ids: unknown;
  revision_order_id: string | null;
  invoice_id: string | null;
  note: string;
  kind: EditKind;
  price_cents: number | null;
  status: EditStatus;
  ready_at: Date | null;
  assigned_designer_id: string | null;
  requested_by_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

function parseDesignIds(raw: unknown, fallback: string | null): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
      }
    } catch {
      /* ignore */
    }
  }
  return fallback ? [fallback] : [];
}

type EditJoinRow = EditRow & {
  order_ref: string | null;
  order_name: string | null;
  order_currency: string | null;
  revision_ref: string | null;
  invoice_status: string | null;
  designer_initials: string | null;
  designer_first: string | null;
};

type ActivityRow = {
  id: string;
  order_id: string | null;
  actor_id: string | null;
  event: string;
  meta: unknown;
  created_at: Date;
  actor_initials: string | null;
  actor_first: string | null;
  actor_last: string | null;
};

@Injectable()
export class EditsService {
  constructor(
    private db: DbService,
    private billing: BillingService,
  ) {}

  // --- mapping helpers -----------------------------------------------------

  private editDto(e: EditJoinRow) {
    const designIds = parseDesignIds(e.design_ids, e.design_id);
    return {
      id: e.id,
      orderId: e.order_id,
      designId: designIds[0] ?? e.design_id,
      designIds,
      revisionOrderId: e.revision_order_id,
      invoiceId: e.invoice_id,
      invoiceStatus: e.invoice_status ?? null,
      note: e.note,
      kind: e.kind,
      priceCents: e.price_cents,
      status: e.status,
      readyAt: e.ready_at,
      assignedDesignerId: e.assigned_designer_id,
      requestedById: e.requested_by_id,
      createdAt: e.created_at,
      resolvedAt: e.resolved_at,
      orderRef: e.order_ref,
      orderName: e.order_name,
      currency: e.order_currency ?? 'USD',
      revisionRef: e.revision_ref,
      designer: e.assigned_designer_id
        ? {
            id: e.assigned_designer_id,
            initials: e.designer_initials,
            firstName: e.designer_first,
          }
        : null,
    };
  }

  private async getOrderRow(id: string): Promise<OrderRow | null> {
    return this.db.queryOne<OrderRow>(
      'SELECT id, human_ref, customer_id, client_user_id, service_type, name, status, price_cents, currency FROM orders WHERE id = ? LIMIT 1',
      [id],
    );
  }

  /** Insert an activity_logs row using either the pool or a transaction. */
  private async writeLog(
    runner: SqlRunner,
    input: {
      orderId: string | null;
      actorId: string | null;
      event: string;
      meta?: unknown;
    },
  ): Promise<void> {
    await runner.execute(
      'INSERT INTO activity_logs (id, order_id, actor_id, event, meta) VALUES (?, ?, ?, ?, ?)',
      [
        randomUUID(),
        input.orderId,
        input.actorId,
        input.event,
        input.meta != null ? JSON.stringify(input.meta) : null,
      ],
    );
  }

  private async loadEdit(id: string) {
    const row = await this.db.queryOne<EditJoinRow>(
      `SELECT e.*, o.human_ref AS order_ref, o.name AS order_name, o.currency AS order_currency,
              ro.human_ref AS revision_ref,
              inv.status AS invoice_status,
              d.initials AS designer_initials, d.first_name AS designer_first
         FROM edit_requests e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN orders ro ON ro.id = e.revision_order_id
         LEFT JOIN users d ON d.id = e.assigned_designer_id
         LEFT JOIN invoices inv ON inv.id = e.invoice_id
        WHERE e.id = ? LIMIT 1`,
      [id],
    );
    return row ? this.editDto(row) : null;
  }

  // --- admin flows ---------------------------------------------------------

  private assertStaff(user: AuthUser | undefined): asserts user is AuthUser {
    assertAuthUser(user);
    if (!isStaffRole(user.role)) throw new ForbiddenException();
  }

  private async resolveDesignIds(orderId: string, requested?: string[] | null) {
    const designs = await this.db.query<{ id: string }>(
      'SELECT id FROM order_designs WHERE order_id = ?',
      [orderId],
    );
    const allowed = new Set(designs.map((d) => d.id));
    const ids = [...new Set((requested ?? []).filter((id) => allowed.has(id)))];
    if (ids.length > 0) return ids;
    if (designs.length === 1) return [designs[0].id];
    if (designs.length === 0) return [];
    throw new BadRequestException('Pick which designs need a revision');
  }

  /** Put the revised designs back in progress without removing files already delivered. */
  private async reopenDesigns(orderId: string, designIds: string[]) {
    const ids =
      designIds.length > 0
        ? designIds
        : (
            await this.db.query<{ id: string }>(
              'SELECT id FROM order_designs WHERE order_id = ?',
              [orderId],
            )
          ).map((row) => row.id);
    if (ids.length === 0) return;
    await this.db.execute(
      `UPDATE order_designs SET status = ?
        WHERE order_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      [DesignStatus.IN_PROGRESS, orderId, ...ids],
    );
  }

  /** After a revision closes, the order is delivered again only when every design is delivered. */
  private async settleOrderAfterRevision(orderId: string) {
    const open = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM edit_requests WHERE order_id = ? AND status = ? LIMIT 1',
      [orderId, EditStatus.PENDING],
    );
    if (open) {
      await this.db.execute(
        'UPDATE orders SET status = ?, completed_at = NULL WHERE id = ?',
        [OrderStatus.REVISION_REQUESTED, orderId],
      );
      return;
    }
    const designs = await this.db.query<{ status: string }>(
      'SELECT status FROM order_designs WHERE order_id = ?',
      [orderId],
    );
    const allDelivered =
      designs.length > 0 && designs.every((row) => row.status === DesignStatus.DELIVERED);
    if (allDelivered) {
      await this.db.execute(
        'UPDATE orders SET status = ?, completed_at = COALESCE(completed_at, NOW()) WHERE id = ?',
        [OrderStatus.COMPLETED, orderId],
      );
      return;
    }
    await this.db.execute(
      'UPDATE orders SET status = ?, completed_at = NULL WHERE id = ?',
      [OrderStatus.IN_PROGRESS, orderId],
    );
  }

  private async ensureRevisionInvoice(
    order: OrderRow,
    editId: string,
    priceCents: number,
    note: string,
  ) {
    if (!order.customer_id) {
      throw new BadRequestException('Link a customer before charging for a revision');
    }
    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      throw new BadRequestException('Enter a price for a paid revision');
    }
    const current = await this.db.queryOne<{ invoice_id: string | null }>(
      'SELECT invoice_id FROM edit_requests WHERE id = ? LIMIT 1',
      [editId],
    );
    const covers = `Revision for ${order.name ?? order.human_ref ?? 'order'}${note ? `: ${note.slice(0, 120)}` : ''}`;
    if (current?.invoice_id) {
      await this.db.execute(
        `UPDATE invoices SET amount_cents = ?, covers_text = ?
          WHERE id = ? AND status = ?`,
        [priceCents, covers, current.invoice_id, InvoiceStatus.AWAITING],
      );
      return;
    }
    const invoice = await this.billing.createRevisionInvoice({
      customerId: order.customer_id,
      orderId: order.id,
      amountCents: priceCents,
      coversText: covers,
    });
    await this.db.execute('UPDATE edit_requests SET invoice_id = ? WHERE id = ?', [
      invoice.id,
      editId,
    ]);
  }

  private async releaseUnpaidRevisionInvoice(editId: string) {
    const current = await this.db.queryOne<{ invoice_id: string | null }>(
      'SELECT invoice_id FROM edit_requests WHERE id = ? LIMIT 1',
      [editId],
    );
    if (!current?.invoice_id) return;
    await this.db.execute(
      'UPDATE invoices SET status = ? WHERE id = ? AND status = ?',
      [InvoiceStatus.CANCELLED, current.invoice_id, InvoiceStatus.AWAITING],
    );
  }

  private async backfillPaidInvoices(rows: EditJoinRow[]) {
    let changed = false;
    for (const row of rows) {
      if (row.kind !== EditKind.PAID || row.invoice_id) continue;
      const priceCents = Number(row.price_cents);
      if (row.status !== EditStatus.PENDING || !Number.isInteger(priceCents) || priceCents <= 0) continue;
      const order = await this.getOrderRow(row.order_id);
      if (!order) continue;
      await this.ensureRevisionInvoice(order, row.id, priceCents, row.note);
      changed = true;
    }
    return changed;
  }

  private async applyRevisionWork(
    order: OrderRow,
    editId: string,
    designIds: string[],
    kind: EditKind,
    priceCents: number | null,
    note: string,
  ) {
    await this.db.execute(
      'UPDATE orders SET status = ?, completed_at = NULL WHERE id = ?',
      [OrderStatus.REVISION_REQUESTED, order.id],
    );
    await this.reopenDesigns(order.id, designIds);
    if (kind === EditKind.PAID) {
      await this.ensureRevisionInvoice(order, editId, priceCents ?? 0, note);
    } else {
      await this.releaseUnpaidRevisionInvoice(editId);
    }
  }

  async createEdit(
    user: AuthUser | undefined,
    orderId: string,
    input: {
      note: string;
      kind: EditKind;
      priceCents?: number | null;
      designId?: string | null;
      designIds?: string[] | null;
      assignedDesignerId?: string | null;
    },
  ) {
    this.assertStaff(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const note = input.note.trim();
    if (!note) throw new BadRequestException('Describe what needs to change');
    const kind = input.kind === EditKind.PAID ? EditKind.PAID : EditKind.FREE;
    const priceCents =
      kind === EditKind.PAID
        ? typeof input.priceCents === 'number'
          ? input.priceCents
          : 0
        : null;
    if (kind === EditKind.PAID && (priceCents ?? 0) <= 0) {
      throw new BadRequestException('Enter a price for a paid revision');
    }
    if (kind === EditKind.PAID && !order.customer_id) {
      throw new BadRequestException('Link a customer before charging for a revision');
    }
    const requested = [
      ...(input.designIds ?? []),
      ...(input.designId ? [input.designId] : []),
    ];
    const designIds = await this.resolveDesignIds(orderId, requested);

    const editId = await this.db.withTransaction(async (tx) => {
      const id = randomUUID();
      await tx.execute(
        `INSERT INTO edit_requests
           (id, order_id, design_id, design_ids, note, kind, price_cents, status, assigned_designer_id, requested_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orderId,
          designIds[0] ?? null,
          JSON.stringify(designIds),
          note,
          kind,
          priceCents,
          EditStatus.PENDING,
          input.assignedDesignerId ?? null,
          user.id,
        ],
      );

      await tx.execute('UPDATE orders SET status = ? WHERE id = ?', [
        OrderStatus.REVISION_REQUESTED,
        orderId,
      ]);

      await this.writeLog(tx, {
        orderId,
        actorId: user.id,
        event: 'edit_requested',
        meta: { editId: id, kind, note, designIds, source: 'staff' },
      });

      if (order.client_user_id) {
        await tx.execute(
          'INSERT INTO notifications (id, user_id, title, body, link) VALUES (?, ?, ?, ?, ?)',
          [
            randomUUID(),
            order.client_user_id,
            'Revision started',
            `We started a revision on your order - ${order.name ?? ''}`,
            `/portal/orders/${orderId}`,
          ],
        );
      }

      return id;
    });

    await this.applyRevisionWork(order, editId, designIds, kind, priceCents, note);
    return this.loadEdit(editId);
  }
  async listEdits(
    user: AuthUser | undefined,
    filters: {
      status?: EditStatus;
      kind?: EditKind;
      assigned?: 'yes' | 'no';
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    this.assertStaff(user);
    const { page, pageSize, offset } = normalizePage(filters);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      where.push('e.status = ?');
      params.push(filters.status);
    }
    if (filters.kind) {
      where.push('e.kind = ?');
      params.push(filters.kind);
    }
    if (filters.assigned === 'yes') {
      where.push('e.assigned_designer_id IS NOT NULL');
    } else if (filters.assigned === 'no') {
      where.push('e.assigned_designer_id IS NULL');
    }
    if (filters.q) {
      where.push(
        `(o.human_ref LIKE ? OR o.name LIKE ? OR c.name LIKE ? OR e.note LIKE ?)`,
      );
      const like = `%${filters.q}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const fromSql = `FROM edit_requests e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN orders ro ON ro.id = e.revision_order_id
         LEFT JOIN users d ON d.id = e.assigned_designer_id
         LEFT JOIN invoices inv ON inv.id = e.invoice_id
         ${whereSql}`;
    const countRow = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n ${fromSql}`,
      params,
    );
    const rows = await this.db.query<EditJoinRow>(
      `SELECT e.*, o.human_ref AS order_ref, o.name AS order_name, o.currency AS order_currency,
              ro.human_ref AS revision_ref,
              inv.status AS invoice_status,
              d.initials AS designer_initials, d.first_name AS designer_first
         ${fromSql}
         ORDER BY e.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    return pageResult(
      rows.map((r) => this.editDto(r)),
      Number(countRow?.n ?? 0),
      page,
      pageSize,
    );
  }

  async updateEdit(
    user: AuthUser | undefined,
    editId: string,
    input: { status?: EditStatus; assignedDesignerId?: string | null; ready?: boolean },
  ) {
    this.assertStaff(user);
    const edit = await this.db.queryOne<EditRow>(
      'SELECT * FROM edit_requests WHERE id = ? LIMIT 1',
      [editId],
    );
    if (!edit) throw new NotFoundException('Edit request not found');

    const sets: string[] = [];
    const params: unknown[] = [];
    let becameDone = false;

    if (input.status != null) {
      sets.push('status = ?');
      params.push(input.status);
      if (input.status === EditStatus.DONE && edit.status !== EditStatus.DONE) {
        sets.push('resolved_at = NOW()');
        becameDone = true;
      }
      if (input.status === EditStatus.PENDING) {
        sets.push('resolved_at = NULL');
      }
    }
    if (input.assignedDesignerId !== undefined) {
      sets.push('assigned_designer_id = ?');
      params.push(input.assignedDesignerId ?? null);
    }
    if (input.ready === true) {
      sets.push('ready_at = COALESCE(ready_at, NOW())');
    } else if (input.ready === false) {
      sets.push('ready_at = NULL');
    }

    if (sets.length) {
      params.push(editId);
      await this.db.execute(
        `UPDATE edit_requests SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }

    if (becameDone) {
      await this.writeLog(this.db, {
        orderId: edit.order_id,
        actorId: user.id,
        event: 'edit_done',
        meta: { editId },
      });
      await this.settleOrderAfterRevision(edit.order_id);
    } else if (input.status === EditStatus.PENDING) {
      const ids = parseDesignIds(edit.design_ids, edit.design_id);
      await this.reopenDesigns(edit.order_id, ids);
      await this.db.execute(
        'UPDATE orders SET status = ?, completed_at = NULL WHERE id = ?',
        [OrderStatus.REVISION_REQUESTED, edit.order_id],
      );
    }

    return this.loadEdit(editId);
  }

  async deleteEdit(user: AuthUser | undefined, editId: string) {
    this.assertStaff(user);
    const edit = await this.db.queryOne<EditRow>(
      'SELECT * FROM edit_requests WHERE id = ? LIMIT 1',
      [editId],
    );
    if (!edit) throw new NotFoundException('Edit request not found');
    if (edit.status !== EditStatus.PENDING) {
      throw new BadRequestException('Only an open revision can be deleted');
    }

    const ids = parseDesignIds(edit.design_ids, edit.design_id);
    const others = await this.db.query<{ design_id: string | null; design_ids: unknown }>(
      `SELECT design_id, design_ids FROM edit_requests
        WHERE order_id = ? AND status = ? AND id <> ?`,
      [edit.order_id, EditStatus.PENDING, editId],
    );
    const stillOpen = new Set(
      others.flatMap((row) => parseDesignIds(row.design_ids, row.design_id)),
    );
    await this.releaseUnpaidRevisionInvoice(editId);
    for (const designId of ids) {
      if (stillOpen.has(designId)) continue;
      if (!(await this.designWasDelivered(edit.order_id, designId))) continue;
      await this.db.execute(
        `UPDATE order_designs SET status = ?
          WHERE id = ? AND order_id = ? AND status <> ?`,
        [DesignStatus.DELIVERED, designId, edit.order_id, DesignStatus.DELIVERED],
      );
    }
    await this.db.execute('DELETE FROM edit_requests WHERE id = ?', [editId]);
    await this.writeLog(this.db, {
      orderId: edit.order_id,
      actorId: user.id,
      event: 'edit_deleted',
      meta: { editId, designIds: ids },
    });
    await this.settleOrderAfterRevision(edit.order_id);
    return { ok: true as const };
  }

  private async designWasDelivered(orderId: string, designId: string) {
    const linked = await this.db.queryOne<{ id: string }>(
      `SELECT df.id
         FROM delivery_files df
         JOIN deliveries d ON d.id = df.delivery_id
        WHERE d.order_id = ?
          AND df.design_id = ?
          AND d.released_at IS NOT NULL
          AND (d.kind IS NULL OR d.kind <> 'PREVIEW')
          AND df.original_name NOT LIKE 'Delivered by email'
        LIMIT 1`,
      [orderId, designId],
    );
    if (linked) return true;
    const emailOnly = await this.db.queryOne<{ id: string }>(
      `SELECT d.id
         FROM deliveries d
        WHERE d.order_id = ?
          AND d.released_at IS NOT NULL
          AND (d.kind IS NULL OR d.kind <> 'PREVIEW')
          AND d.delivered_via IN ('EMAIL', 'BOTH')
          AND NOT EXISTS (
            SELECT 1 FROM delivery_files f
             WHERE f.delivery_id = d.id
               AND f.design_id IS NOT NULL
               AND f.original_name NOT LIKE 'Delivered by email'
          )
        LIMIT 1`,
      [orderId],
    );
    return Boolean(emailOnly);
  }

  async getActivity(user: AuthUser | undefined, orderId: string) {
    this.assertStaff(user);
    const rows = await this.db.query<ActivityRow>(
      `SELECT a.id, a.order_id, a.actor_id, a.event, a.meta, a.created_at,
              u.initials AS actor_initials, u.first_name AS actor_first, u.last_name AS actor_last
         FROM activity_logs a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.order_id = ?
        ORDER BY a.created_at DESC`,
      [orderId],
    );
    return rows.map((a) => ({
      id: a.id,
      orderId: a.order_id,
      event: a.event,
      meta: a.meta ?? null,
      createdAt: a.created_at,
      actor: a.actor_id
        ? {
            id: a.actor_id,
            initials: a.actor_initials,
            firstName: a.actor_first,
            lastName: a.actor_last,
          }
        : null,
    }));
  }

  // --- client flows --------------------------------------------------------

  async clientRequestEdit(
    user: AuthUser | undefined,
    orderId: string,
    input: { note: string; designIds?: string[] | null },
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');

    const revisable = new Set<OrderStatus>([
      OrderStatus.COMPLETED,
      OrderStatus.CLOSED,
      OrderStatus.REVISION_REQUESTED,
      OrderStatus.IN_PROGRESS,
      OrderStatus.READY_TO_SEND,
    ]);
    if (!revisable.has(order.status)) {
      throw new BadRequestException(
        'You can request a revision after files have been delivered',
      );
    }

    const note = input.note.trim();
    if (!note) throw new BadRequestException('Describe what needs to change');
    const designIds = await this.resolveDesignIds(orderId, input.designIds);

    const openEdit = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM edit_requests
        WHERE order_id = ? AND status = ?
        ORDER BY created_at ASC
        LIMIT 1`,
      [orderId, EditStatus.PENDING],
    );
    if (openEdit) {
      await this.db.execute(
        'UPDATE edit_requests SET note = ?, design_id = ?, design_ids = ? WHERE id = ?',
        [note, designIds[0] ?? null, JSON.stringify(designIds), openEdit.id],
      );
      await this.writeLog(this.db, {
        orderId,
        actorId: user.id,
        event: 'edit_requested',
        meta: { editId: openEdit.id, kind: EditKind.FREE, source: 'client', note, designIds },
      });
      await this.reopenDesigns(orderId, designIds);
      await this.db.execute(
        'UPDATE orders SET status = ?, completed_at = NULL WHERE id = ?',
        [OrderStatus.REVISION_REQUESTED, orderId],
      );
      return this.loadEdit(openEdit.id);
    }

    const editId = await this.db.withTransaction(async (tx) => {
      const id = randomUUID();
      await tx.execute(
        `INSERT INTO edit_requests
           (id, order_id, design_id, design_ids, note, kind, status, requested_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orderId,
          designIds[0] ?? null,
          JSON.stringify(designIds),
          note,
          EditKind.FREE,
          EditStatus.PENDING,
          user.id,
        ],
      );

      await tx.execute('UPDATE orders SET status = ? WHERE id = ?', [
        OrderStatus.REVISION_REQUESTED,
        orderId,
      ]);

      await this.writeLog(tx, {
        orderId,
        actorId: user.id,
        event: 'edit_requested',
        meta: { editId: id, kind: EditKind.FREE, source: 'client', note, designIds },
      });

      return id;
    });

    await this.reopenDesigns(orderId, designIds);
    await this.db.execute(
      'UPDATE orders SET status = ?, completed_at = NULL WHERE id = ?',
      [OrderStatus.REVISION_REQUESTED, orderId],
    );

    const staffRows = await this.db.query<{ id: string }>(
      "SELECT id FROM users WHERE role IN ('SUPER_ADMIN','ADMIN','SUPPORT')",
    );
    if (staffRows.length) {
      const values = staffRows.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const params: unknown[] = [];
      for (const s of staffRows) {
        params.push(
          randomUUID(),
          s.id,
          'Revision requested',
          `${order.name ?? order.human_ref ?? 'Order'}: ${note.slice(0, 180)}`,
          `/admin/orders/${orderId}`,
        );
      }
      await this.db.execute(
        `INSERT INTO notifications (id, user_id, title, body, link) VALUES ${values}`,
        params,
      );
    }

    return this.loadEdit(editId);
  }

  private queryEdits(whereSql: string, params: unknown[]) {
    return this.db.query<EditJoinRow>(
      `SELECT e.*, o.human_ref AS order_ref, o.name AS order_name, o.currency AS order_currency,
              ro.human_ref AS revision_ref,
              inv.status AS invoice_status,
              d.initials AS designer_initials, d.first_name AS designer_first
         FROM edit_requests e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN orders ro ON ro.id = e.revision_order_id
         LEFT JOIN users d ON d.id = e.assigned_designer_id
         LEFT JOIN invoices inv ON inv.id = e.invoice_id
        WHERE ${whereSql}
        ORDER BY e.created_at DESC`,
      params,
    );
  }

  private async editsWithInvoices(whereSql: string, params: unknown[]) {
    let rows = await this.queryEdits(whereSql, params);
    if (await this.backfillPaidInvoices(rows)) {
      rows = await this.queryEdits(whereSql, params);
    }
    return rows.map((r) => this.editDto(r));
  }

  async listMyAllEdits(user: AuthUser | undefined) {
    assertAuthUser(user);
    return this.editsWithInvoices('o.client_user_id = ?', [user.id]);
  }

  async listMyEdits(user: AuthUser | undefined, orderId: string) {
    assertAuthUser(user);
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    return this.editsWithInvoices('e.order_id = ?', [orderId]);
  }

  async listEditsForOrder(user: AuthUser | undefined, orderId: string) {
    this.assertStaff(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');
    return this.editsWithInvoices('e.order_id = ?', [orderId]);
  }
}
