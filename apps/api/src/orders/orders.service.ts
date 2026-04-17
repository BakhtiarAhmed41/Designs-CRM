import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private storage: SupabaseStorageService,
  ) {}

  async createOrder(client: AuthUser | undefined, data: { serviceType: string; instructions?: string | null; size?: string | null; preferences?: any }) {
    assertAuthUser(client);
    if (client.role !== UserRole.CLIENT) throw new ForbiddenException();

    const order = await this.prisma.order.create({
      data: {
        clientId: client.id,
        serviceType: data.serviceType,
        instructions: data.instructions ?? null,
        size: data.size ?? null,
        preferences: data.preferences ?? null,
        status: OrderStatus.CREATED,
      },
      include: { attachments: true, deliveries: { include: { files: true } } },
    });
    return order;
  }

  async listMyOrders(user: AuthUser | undefined) {
    assertAuthUser(user);
    return this.prisma.order.findMany({
      where: { clientId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { attachments: true },
    });
  }

  async getMyOrder(user: AuthUser | undefined, orderId: string) {
    assertAuthUser(user);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, clientId: user.id },
      include: { attachments: true, deliveries: { include: { files: true }, orderBy: { version: 'desc' } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async uploadOrderAttachments(user: AuthUser | undefined, orderId: string, files: Express.Multer.File[]) {
    assertAuthUser(user);
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');

    const order = await this.prisma.order.findFirst({ where: { id: orderId, clientId: user.id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.CREATED) {
      throw new BadRequestException('Attachments can only be uploaded while order is in CREATED status');
    }

    const bucket = this.storage.getOrdersBucket();

    // Upload first, then insert rows with plain queries (no interactive `$transaction`).
    // Supabase pooler / PgBouncer often cannot start Prisma interactive transactions (P2028).
    const staged: Array<{
      key: string;
      originalName: string;
      mimeType: string | null;
      byteSize: number | null;
    }> = [];
    for (const f of files) {
      const key = this.storage.newObjectKey(['orders', orderId, 'attachments'], f.originalname);
      await this.storage.uploadObject({ bucket, key, body: f.buffer, contentType: f.mimetype });
      staged.push({
        key,
        originalName: f.originalname,
        mimeType: f.mimetype || null,
        byteSize: typeof f.size === 'number' ? f.size : null,
      });
    }

    const out = [];
    for (const s of staged) {
      const row = await this.prisma.orderAttachment.create({
        data: {
          orderId,
          uploadedByRole: UserRole.CLIENT,
          uploadedById: user.id,
          originalName: s.originalName,
          mimeType: s.mimeType,
          byteSize: s.byteSize,
          storageKey: s.key,
        },
      });
      out.push(row);
    }
    return out;
  }

  async getMyAttachmentSignedUrl(user: AuthUser | undefined, orderId: string, attachmentId: string) {
    assertAuthUser(user);
    const attachment = await this.prisma.orderAttachment.findFirst({
      where: { id: attachmentId, orderId, order: { clientId: user.id } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    const url = await this.storage.createSignedUrl({
      bucket: this.storage.getOrdersBucket(),
      key: attachment.storageKey,
      downloadAs: attachment.originalName || 'attachment',
    });
    return { url };
  }

  async listAdminOrders(user: AuthUser | undefined, filters: { status?: OrderStatus; clientId?: string }) {
    assertAuthUser(user);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();
    return this.prisma.order.findMany({
      where: {
        status: filters.status,
        clientId: filters.clientId,
      },
      orderBy: { createdAt: 'desc' },
      include: { attachments: true, client: true },
    });
  }

  async getAdminOrder(user: AuthUser | undefined, orderId: string) {
    assertAuthUser(user);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        attachments: true,
        deliveries: { include: { files: true }, orderBy: { version: 'desc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async approveOrder(user: AuthUser | undefined, orderId: string) {
    assertAuthUser(user);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.CREATED) throw new BadRequestException('Only CREATED orders can be approved');

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.IN_PROGRESS,
        approvedAt: new Date(),
        rejectionReason: null,
        rejectedAt: null,
      },
    });
  }

  async rejectOrder(user: AuthUser | undefined, orderId: string, reason: string) {
    assertAuthUser(user);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();
    if (!reason.trim()) throw new BadRequestException('Rejection reason is required');

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.CREATED) throw new BadRequestException('Only CREATED orders can be rejected');

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.REJECTED,
        rejectionReason: reason.trim(),
        rejectedAt: new Date(),
      },
    });
  }

  async deliverOrder(user: AuthUser | undefined, orderId: string, files: Express.Multer.File[]) {
    assertAuthUser(user);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');

    const bucket = this.storage.getOrdersBucket();

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.IN_PROGRESS) {
      throw new BadRequestException('Deliveries can only be uploaded while order is IN_PROGRESS');
    }

    const latest = await this.prisma.orderDelivery.findFirst({
      where: { orderId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const delivery = await this.prisma.orderDelivery.create({
      data: {
        orderId,
        version: nextVersion,
        createdByAdminId: user.id,
      },
    });
    const deliveryId = delivery.id;
    const deliveryCreatedAt = delivery.createdAt;

    const staged: Array<{
      key: string;
      originalName: string;
      mimeType: string | null;
      byteSize: number | null;
    }> = [];
    for (const f of files) {
      const key = this.storage.newObjectKey(['orders', orderId, 'deliveries', String(nextVersion)], f.originalname);
      await this.storage.uploadObject({ bucket, key, body: f.buffer, contentType: f.mimetype });
      staged.push({
        key,
        originalName: f.originalname,
        mimeType: f.mimetype || null,
        byteSize: typeof f.size === 'number' ? f.size : null,
      });
    }

    const createdFiles = [];
    for (const s of staged) {
      const row = await this.prisma.orderDeliveryFile.create({
        data: {
          deliveryId,
          originalName: s.originalName,
          mimeType: s.mimeType,
          byteSize: s.byteSize,
          storageKey: s.key,
        },
      });
      createdFiles.push(row);
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
    });

    return {
      order: updatedOrder,
      delivery: {
        id: deliveryId,
        orderId,
        version: nextVersion,
        createdAt: deliveryCreatedAt,
        files: createdFiles,
      },
    };
  }

  async getAdminAttachmentSignedUrl(user: AuthUser | undefined, orderId: string, attachmentId: string) {
    assertAuthUser(user);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();
    const attachment = await this.prisma.orderAttachment.findFirst({ where: { id: attachmentId, orderId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    const url = await this.storage.createSignedUrl({
      bucket: this.storage.getOrdersBucket(),
      key: attachment.storageKey,
      downloadAs: attachment.originalName || 'attachment',
    });
    return { url };
  }

  async getAdminDeliveryFileSignedUrl(user: AuthUser | undefined, orderId: string, deliveryFileId: string) {
    assertAuthUser(user);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();
    const file = await this.prisma.orderDeliveryFile.findFirst({
      where: { id: deliveryFileId, delivery: { orderId } },
    });
    if (!file) throw new NotFoundException('Delivery file not found');
    const url = await this.storage.createSignedUrl({
      bucket: this.storage.getOrdersBucket(),
      key: file.storageKey,
      downloadAs: file.originalName || 'delivery',
    });
    return { url };
  }

  async getMyDeliveryFileSignedUrl(user: AuthUser | undefined, orderId: string, deliveryFileId: string) {
    assertAuthUser(user);
    const file = await this.prisma.orderDeliveryFile.findFirst({
      where: { id: deliveryFileId, delivery: { orderId, order: { clientId: user.id } } },
    });
    if (!file) throw new NotFoundException('Delivery file not found');
    const url = await this.storage.createSignedUrl({
      bucket: this.storage.getOrdersBucket(),
      key: file.storageKey,
      downloadAs: file.originalName || 'delivery',
    });
    return { url };
  }
}

