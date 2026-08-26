import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { EditKind, EditStatus, OrderStatus, OrderType, UserRole } from '../common/enums';
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
  revision_order_id: string | null;
  note: string;
  kind: EditKind;
  price_cents: number | null;
  status: EditStatus;
  assigned_designer_id: string | null;
  requested_by_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

type EditJoinRow = EditRow & {
  order_ref: string | null;
  order_name: string | null;
  order_currency: string | null;
  revision_ref: string | null;
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
  constructor(private db: DbService) {}

  // --- mapping helpers -----------------------------------------------------

  private editDto(e: EditJoinRow) {
    return {
      id: e.id,
      orderId: e.order_id,
      designId: e.design_id,
      revisionOrderId: e.revision_order_id,
      note: e.note,
      kind: e.kind,
      priceCents: e.price_cents,
      status: e.status,
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
              d.initials AS designer_initials, d.first_name AS designer_first
         FROM edit_requests e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN orders ro ON ro.id = e.revision_order_id
         LEFT JOIN users d ON d.id = e.assigned_designer_id
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

  async createEdit(
    user: AuthUser | undefined,
    orderId: string,
    input: {
      note: string;
      kind: EditKind;
      priceCents?: number | null;
      designId?: string | null;
      assignedDesignerId?: string | null;
    },
  ) {
    this.assertStaff(user);
    const order = await this.getOrderRow(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const note = input.note.trim();
    const kind = input.kind === EditKind.PAID ? EditKind.PAID : EditKind.FREE;
    const priceCents =
      kind === EditKind.PAID
        ? typeof input.priceCents === 'number'
          ? input.priceCents
          : 0
        : null;

    const openEdit = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM edit_requests
        WHERE order_id = ? AND status = ?
        ORDER BY created_at ASC
        LIMIT 1`,
      [orderId, EditStatus.PENDING],
    );
    if (openEdit) {
      const existing = await this.loadEdit(openEdit.id);
      if (existing) return existing;
    }

    const editId = await this.db.withTransaction(async (tx) => {
      // Create a linked "-R" revision child order.
      const revisionOrderId = randomUUID();
      const prior = await tx.queryOne<{ n: number | string }>(
        'SELECT COUNT(*) AS n FROM orders WHERE parent_order_id = ?',
        [order.id],
      );
      const seq = Number(prior?.n ?? 0) + 1;
      const base = order.human_ref ?? 'REV';
      const revisionRef = seq === 1 ? `${base}-R` : `${base}-R${seq}`;
      await tx.execute(
        `INSERT INTO orders
           (id, human_ref, customer_id, client_user_id, type, service_type, name, status, price_cents, currency, parent_order_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          revisionOrderId,
          revisionRef,
          order.customer_id,
          order.client_user_id,
          OrderType.ORDER,
          order.service_type,
          order.name,
          OrderStatus.IN_PROGRESS,
          kind === EditKind.PAID ? (priceCents ?? 0) : 0,
          order.currency || 'USD',
          order.id,
        ],
      );

      const id = randomUUID();
      await tx.execute(
        `INSERT INTO edit_requests
           (id, order_id, design_id, revision_order_id, note, kind, price_cents, status, assigned_designer_id, requested_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orderId,
          input.designId ?? null,
          revisionOrderId,
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
        meta: { editId: id, kind, revisionOrderId, revisionRef },
      });

      if (order.client_user_id) {
        await tx.execute(
          'INSERT INTO notifications (id, user_id, title, body, link) VALUES (?, ?, ?, ?, ?)',
          [
            randomUUID(),
            order.client_user_id,
            'Revision started',
            `We started a revision on your order - ${order.name ?? ''}`,
            `/orders/${orderId}`,
          ],
        );
      }

      return id;
    });

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
         ${whereSql}`;
    const countRow = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n ${fromSql}`,
      params,
    );
    const rows = await this.db.query<EditJoinRow>(
      `SELECT e.*, o.human_ref AS order_ref, o.name AS order_name, o.currency AS order_currency,
              ro.human_ref AS revision_ref,
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
    input: { status?: EditStatus; assignedDesignerId?: string | null },
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
    }

    return this.loadEdit(editId);
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
    input: { note: string },
  ) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');

    const note = input.note.trim();

    const openEdit = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM edit_requests
        WHERE order_id = ? AND status = ?
        ORDER BY created_at ASC
        LIMIT 1`,
      [orderId, EditStatus.PENDING],
    );
    if (openEdit) {
      if (note) {
        await this.db.execute('UPDATE edit_requests SET note = ? WHERE id = ?', [
          note,
          openEdit.id,
        ]);
      }
      return this.loadEdit(openEdit.id);
    }

    const editId = await this.db.withTransaction(async (tx) => {
      const id = randomUUID();
      await tx.execute(
        `INSERT INTO edit_requests
           (id, order_id, note, kind, status, requested_by_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, orderId, note, EditKind.FREE, EditStatus.PENDING, user.id],
      );

      await tx.execute('UPDATE orders SET status = ? WHERE id = ?', [
        OrderStatus.REVISION_REQUESTED,
        orderId,
      ]);

      await this.writeLog(tx, {
        orderId,
        actorId: user.id,
        event: 'edit_requested',
        meta: { editId: id, kind: EditKind.FREE, source: 'client' },
      });

      return id;
    });

    // Notify staff (outside the transaction to keep it lean).
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
          'Edit requested',
          `Client requested an edit - ${order.name ?? order.human_ref ?? ''}`,
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

  async listMyEdits(user: AuthUser | undefined, orderId: string) {
    assertAuthUser(user);
    const order = await this.getOrderRow(orderId);
    if (!order || order.client_user_id !== user.id)
      throw new NotFoundException('Order not found');
    const rows = await this.db.query<EditJoinRow>(
      `SELECT e.*, o.human_ref AS order_ref, o.name AS order_name, o.currency AS order_currency,
              ro.human_ref AS revision_ref,
              d.initials AS designer_initials, d.first_name AS designer_first
         FROM edit_requests e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN orders ro ON ro.id = e.revision_order_id
         LEFT JOIN users d ON d.id = e.assigned_designer_id
        WHERE e.order_id = ?
        ORDER BY e.created_at DESC`,
      [orderId],
    );
    return rows.map((r) => this.editDto(r));
  }
}
