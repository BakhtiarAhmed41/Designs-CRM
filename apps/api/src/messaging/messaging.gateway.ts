import { Logger } from '@nestjs/common';
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
import { getEnv } from '../config/env';

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
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private jwt: JwtService) {}

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

  async handleConnection(client: Socket) {
    const user = await this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    await client.join(`user:${user.id}`);
    await client.join('team:group');
    this.logger.debug(`socket connected user=${user.id}`);
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user as SocketUser | undefined;
    if (user) this.logger.debug(`socket disconnected user=${user.id}`);
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
}
