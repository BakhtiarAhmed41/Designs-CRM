import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { Presence, STAFF_ROLES } from '../common/enums';
import { getEnv } from '../config/env';
import { DbService } from '../db/db.service';
import { NotificationEvents } from '../notifications/notification.events';

type SocketUser = {
  id: string;
  role: string;
};

@WebSocketGateway({
  namespace: '/messaging',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class MessagingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(MessagingGateway.name);
  /** userId → active socket ids */
  private readonly socketsByUser = new Map<string, Set<string>>();
  /** Grace period before marking OFF so brief reconnects don't flicker */
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private jwt: JwtService,
    private db: DbService,
    private notifications: NotificationEvents,
  ) {}

  onModuleInit() {
    this.notifications.onCreated((userId) => {
      this.emitToUser(userId, 'notification:new', { userId });
    });
    void this.db
      .execute(
        `UPDATE users SET presence = ? WHERE role IN ('SUPER_ADMIN','ADMIN','SUPPORT','DESIGNER')`,
        [Presence.OFF],
      )
      .catch((err) => {
        this.logger.warn(`failed to reset presence on boot: ${String(err)}`);
      });
  }

  /** Staff who currently have an open socket — source of truth for Online. */
  connectedUserIds(): Set<string> {
    const ids = new Set<string>();
    for (const [userId, sockets] of this.socketsByUser) {
      if (sockets.size > 0) ids.add(userId);
    }
    return ids;
  }

  /** Tell other staff after a REST presence change (dropdown on Team). */
  broadcastPresence(userId: string, presence: Presence) {
    this.server?.to('team:group').emit('presence:update', {
      userId,
      presence,
    });
  }

  private parseCookieToken(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(';').map((p) => p.trim());
    for (const part of parts) {
      const [k, ...rest] = part.split('=');
      if (k === 'access_token' || k === 'token' || k === 'jwt') {
        return decodeURIComponent(rest.join('='));
      }
    }
    return null;
  }

  private async authenticate(client: Socket): Promise<SocketUser | null> {
    try {
      const authToken =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.headers.authorization?.startsWith('Bearer ')
          ? client.handshake.headers.authorization.slice(7)
          : null) ||
        this.parseCookieToken(client.handshake.headers.cookie);
      if (!authToken) return null;
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        role?: string;
      }>(authToken, {
        secret: getEnv().JWT_ACCESS_SECRET,
      });
      if (!payload?.sub) return null;
      return { id: payload.sub, role: payload.role ?? '' };
    } catch {
      return null;
    }
  }

  private isStaff(role: string) {
    return (STAFF_ROLES as readonly string[]).includes(role);
  }

  private async setPresence(userId: string, presence: Presence) {
    await this.db.execute('UPDATE users SET presence = ? WHERE id = ?', [
      presence,
      userId,
    ]);
    this.server?.to('team:group').emit('presence:update', {
      userId,
      presence,
    });
  }

  async handleConnection(client: Socket) {
    const user = await this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    await client.join(`user:${user.id}`);
    if (this.isStaff(user.role)) {
      await client.join('team:group');
    }

    const existing = this.socketsByUser.get(user.id) ?? new Set<string>();
    existing.add(client.id);
    this.socketsByUser.set(user.id, existing);

    const pending = this.offlineTimers.get(user.id);
    if (pending) {
      clearTimeout(pending);
      this.offlineTimers.delete(user.id);
    }

    if (this.isStaff(user.role) && existing.size === 1) {
      try {
        await this.setPresence(user.id, Presence.ON);
      } catch (err) {
        this.logger.warn(`failed to set presence ON for ${user.id}: ${String(err)}`);
      }
    }

    this.logger.debug(`socket connected user=${user.id}`);
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user as SocketUser | undefined;
    if (!user) return;
    this.logger.debug(`socket disconnected user=${user.id}`);

    const set = this.socketsByUser.get(user.id);
    if (set) {
      set.delete(client.id);
      if (set.size === 0) this.socketsByUser.delete(user.id);
    }

    if (!this.isStaff(user.role)) return;
    if ((this.socketsByUser.get(user.id)?.size ?? 0) > 0) return;

    const prev = this.offlineTimers.get(user.id);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(() => {
      this.offlineTimers.delete(user.id);
      if ((this.socketsByUser.get(user.id)?.size ?? 0) > 0) return;
      void this.setPresence(user.id, Presence.OFF).catch((err) => {
        this.logger.warn(`failed to set presence OFF for ${user.id}: ${String(err)}`);
      });
    }, 15_000);
    this.offlineTimers.set(user.id, timer);
  }

  @SubscribeMessage('presence:away')
  async markAway(@ConnectedSocket() client: Socket) {
    const user = client.data.user as SocketUser | undefined;
    if (!user || !this.isStaff(user.role)) return { ok: false };
    await this.setPresence(user.id, Presence.AWAY);
    return { ok: true };
  }

  @SubscribeMessage('presence:online')
  async markOnline(@ConnectedSocket() client: Socket) {
    const user = client.data.user as SocketUser | undefined;
    if (!user || !this.isStaff(user.role)) return { ok: false };
    await this.setPresence(user.id, Presence.ON);
    return { ok: true };
  }

  @SubscribeMessage('join:conversation')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    if (!client.data.user || !body?.conversationId) return { ok: false };
    await client.join(`conversation:${body.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('leave:conversation')
  async leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    if (!body?.conversationId) return { ok: false };
    await client.leave(`conversation:${body.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('join:team-dm')
  async joinTeamDm(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { peerId?: string },
  ) {
    const user = client.data.user as SocketUser | undefined;
    if (!user || !body?.peerId) return { ok: false };
    const room = this.dmRoom(user.id, body.peerId);
    await client.join(room);
    return { ok: true, room };
  }

  dmRoom(a: string, b: string) {
    return `team:dm:${[a, b].sort().join(':')}`;
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitToConversation(conversationId: string, event: string, payload: unknown) {
    if (!conversationId) return;
    this.server?.to(`conversation:${conversationId}`).emit(event, payload);
  }

  emitTeamDm(a: string, b: string, event: string, payload: unknown) {
    this.server?.to(this.dmRoom(a, b)).emit(event, payload);
    this.emitToUser(a, event, payload);
    this.emitToUser(b, event, payload);
  }

  emitTeamGroup(event: string, payload: unknown) {
    this.server?.to('team:group').emit(event, payload);
  }

  isUserOnline(userId: string) {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }
}
