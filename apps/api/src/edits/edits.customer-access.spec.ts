import { ForbiddenException } from '@nestjs/common';
import { EditsController } from './edits.controller';
import { OrdersService } from '../orders/orders.service';

describe('customer revision access', () => {
  it('rejects the legacy revision creation endpoint', () => {
    const controller = new EditsController({} as any);
    expect(() => controller.requestEdit()).toThrow(ForbiddenException);
  });

  it('rejects preview change requests before touching order data', async () => {
    const db = { queryOne: jest.fn(), execute: jest.fn() };
    const service = new OrdersService(db as any, {} as any, {} as any, {} as any, {} as any);
    await expect(service.decidePreview({ id: 'client', role: 'CLIENT' } as any, 'order', 'preview', {
      decision: 'CHANGES_REQUESTED', note: 'Change the design',
    })).rejects.toThrow(ForbiddenException);
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
});
