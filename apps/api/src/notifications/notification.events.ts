import { Injectable } from '@nestjs/common';

type CreatedHandler = (userId: string) => void;

@Injectable()
export class NotificationEvents {
  private readonly handlers: CreatedHandler[] = [];

  onCreated(handler: CreatedHandler) {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  emitCreated(userId: string) {
    for (const handler of this.handlers) {
      handler(userId);
    }
  }
}
