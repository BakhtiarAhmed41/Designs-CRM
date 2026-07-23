import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DbService } from '../db/db.service';

function assertAuthUser(user: AuthUser | undefined): asserts user is AuthUser {
  if (!user) throw new ForbiddenException();
}

type OrderHit = {
  id: string;
  human_ref: string | null;
  name: string | null;
  status: string;
};

type CustomerHit = {
  id: string;
  name: string | null;
  email: string | null;
};

type ConversationHit = {
  id: string;
  subject: string | null;
};

@Injectable()
export class SearchService {
  constructor(private db: DbService) {}

  async search(user: AuthUser | undefined, q: string | undefined) {
    assertAuthUser(user);
    const term = q?.trim();
    if (!term) {
      return { orders: [], customers: [], conversations: [] };
    }
    const like = `%${term}%`;

    const orders = await this.db.query<OrderHit>(
      `SELECT id, human_ref, name, status
         FROM orders
        WHERE human_ref LIKE ? OR name LIKE ? OR service_type LIKE ?
        ORDER BY created_at DESC
        LIMIT 10`,
      [like, like, like],
    );

    const customers = await this.db.query<CustomerHit>(
      `SELECT id, name, email
         FROM customers
        WHERE name LIKE ? OR email LIKE ?
        ORDER BY created_at DESC
        LIMIT 10`,
      [like, like],
    );

    const conversations = await this.db.query<ConversationHit>(
      `SELECT id, subject
         FROM conversations
        WHERE subject LIKE ?
        ORDER BY last_message_at IS NULL, last_message_at DESC, created_at DESC
        LIMIT 10`,
      [like],
    );

    return {
      orders: orders.map((o) => ({
        id: o.id,
        ref: o.human_ref,
        name: o.name,
        status: o.status,
      })),
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
      })),
      conversations: conversations.map((c) => ({
        id: c.id,
        subject: c.subject,
      })),
    };
  }
}
