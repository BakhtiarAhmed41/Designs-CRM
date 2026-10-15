import { OrdersService } from './orders.service';
import { UserRole } from '../common/enums';

describe('customer quote drafts', () => {
  const user = { id: 'customer-user', role: UserRole.CLIENT } as any;
  const payload = { designName: 'Saved logo', formats: ['DST', 'PES'], designs: [{ name: 'Saved logo', notes: 'Left chest' }] };
  const updatedAt = new Date('2026-10-15T12:00:00Z');
  function setup() {
    const db = { query: jest.fn(), queryOne: jest.fn(), execute: jest.fn().mockResolvedValue({}) };
    return { db, service: new OrdersService(db as any, {} as any, {} as any, {} as any, {} as any) };
  }

  it('saves draft details under the current customer and selected service', async () => {
    const { service, db } = setup();
    db.queryOne.mockResolvedValue(null);
    await service.saveQuoteDraft(user, 'embroidery', payload);
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('user_id = ? AND service_key = ?'), [user.id, 'embroidery']);
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO quote_drafts'), [expect.any(String), user.id, 'embroidery', JSON.stringify(payload)]);
  });

  it.each([payload, JSON.stringify(payload)])('lists and restores JSON objects and MariaDB JSON text', async (stored) => {
    const { service, db } = setup();
    db.query.mockResolvedValue([{ service_key: 'embroidery', payload: stored, updated_at: updatedAt }]);
    db.queryOne.mockResolvedValue({ payload: stored, updated_at: updatedAt });
    expect((await service.listQuoteDrafts(user)).drafts[0]).toEqual({ serviceKey: 'embroidery', payload, updatedAt });
    expect((await service.getQuoteDraft(user, 'embroidery')).draft).toEqual({ payload, updatedAt });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = ?'), [user.id]);
  });

  it('resumes legacy CNC drafts saved under the old svg service key', async () => {
    const { service, db } = setup();
    db.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ payload, updated_at: updatedAt });
    expect((await service.getQuoteDraft(user, 'laser')).draft?.payload).toEqual(payload);
    expect(db.queryOne).toHaveBeenLastCalledWith(expect.stringContaining('user_id = ? AND service_key = ?'), [user.id, 'svg']);
  });

  it('handles missing drafts and rejects unauthenticated access', async () => {
    const { service, db } = setup();
    db.queryOne.mockResolvedValue(null);
    expect(await service.getQuoteDraft(user, 'embroidery')).toEqual({ draft: null });
    await expect(service.listQuoteDrafts(undefined)).rejects.toThrow();
    await expect(service.getQuoteDraft(undefined, 'embroidery')).rejects.toThrow();
  });
});
