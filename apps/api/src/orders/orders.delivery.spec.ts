import { OrdersService } from './orders.service';

describe('saved order deliveries', () => {
  const user = { id: 'admin', role: 'ADMIN' } as any;
  const order = { id: 'order', status: 'REVISION_REQUESTED', client_user_id: 'client', name: 'Logo' };
  const draft = (id: string, designId: string, editId: string | null = null) => ({
    id, editId, kind: 'FINAL', version: 1, releasedAt: null, deliveredVia: 'PORTAL',
    files: [{ id: `${id}-file`, designId, originalName: `${designId}.png` }],
  });

  function setup(deliveries: any[]) {
    const db = {
      execute: jest.fn(async (sql: string, params: any[]) => {
        if (sql.includes('UPDATE deliveries')) {
          for (const delivery of deliveries) {
            if (params.includes(delivery.id)) delivery.releasedAt = new Date();
          }
        }
        return {};
      }),
      queryOne: jest.fn().mockResolvedValue({ version: 1 }),
    };
    const storage = { newObjectKey: jest.fn().mockReturnValue('key'), uploadObject: jest.fn().mockResolvedValue(undefined) };
    const notifications = { createFor: jest.fn().mockResolvedValue(undefined) };
    const mail = { sendFilesReady: jest.fn().mockResolvedValue(undefined) };
    const service = new OrdersService(db as any, storage as any, notifications as any, {} as any, mail as any);
    const internals = service as any;
    internals.getOrderRow = jest.fn().mockResolvedValue(order);
    internals.getDeliveries = jest.fn().mockResolvedValue(deliveries);
    internals.getDesigns = jest.fn().mockResolvedValue([
      { id: 'a', status: 'IN_PROGRESS' }, { id: 'b', status: 'IN_PROGRESS' },
    ]);
    internals.keptLineNames = jest.fn().mockResolvedValue([]);
    internals.pickCountedDesigns = (designs: any[]) => designs;
    internals.insertDeliveryFile = jest.fn().mockResolvedValue(undefined);
    internals.closeRevisionDesigns = jest.fn().mockResolvedValue(undefined);
    internals.hasOpenRevision = jest.fn().mockResolvedValue(true);
    internals.notifyAdmins = jest.fn().mockResolvedValue(undefined);
    internals.customerEmailForOrder = jest.fn().mockResolvedValue('customer@example.com');
    internals.assembleOrder = jest.fn().mockResolvedValue({ id: 'order' });
    return { service, db, notifications, mail, internals };
  }

  it('saves a revision privately without removing delivered files or finishing the revision', async () => {
    const released = { ...draft('original', 'a'), releasedAt: new Date() };
    const { service, db, notifications, mail, internals } = setup([released]);
    await service.deliverOrder(user, 'order', [{ originalname: 'preview.png', mimetype: 'image/png', buffer: Buffer.from('image') }] as any, {
      designIds: ['a'], release: false, editId: 'revision', notifyEmail: false, notifySms: false,
    });
    expect(db.execute.mock.calls.some(([sql]: [string]) => sql.includes('DELETE'))).toBe(false);
    expect(db.execute.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE order_designs'))).toBe(false);
    const insert = db.execute.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO deliveries'));
    expect(insert?.[1][5]).toBeNull();
    expect(insert?.[1][8]).toBe('revision');
    expect(internals.closeRevisionDesigns).not.toHaveBeenCalled();
    expect(notifications.createFor).not.toHaveBeenCalled();
    expect(mail.sendFilesReady).not.toHaveBeenCalled();
  });

  it('publishes only selected saved designs together and sends one customer notification', async () => {
    const { service, db, notifications, mail } = setup([
      draft('saved-a', 'a'), draft('saved-b', 'b'), draft('other-revision', 'private-design', 'revision'),
    ]);
    await service.deliverOrder(user, 'order', [], { savedDeliveryIds: ['saved-a', 'saved-b'] });
    const release = db.execute.mock.calls.find(([sql]: [string]) => sql.includes('UPDATE deliveries'));
    expect(release?.[1]).toEqual(['order', 'saved-a', 'saved-b']);
    expect(db.execute.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO deliveries'))).toBe(false);
    expect(db.execute.mock.calls.filter(([sql]: [string]) => sql.includes('UPDATE order_designs')).map(([, params]: any) => params[1])).toEqual(['a', 'b']);
    expect(notifications.createFor).toHaveBeenCalledTimes(1);
    expect(mail.sendFilesReady).toHaveBeenCalledTimes(1);
    expect(mail.sendFilesReady).toHaveBeenCalledWith('customer@example.com', 'Logo', 'order', ['a.png', 'b.png']);
  });

  it.each([
    ['missing draft', [], null],
    ['another revision', [draft('saved', 'a', 'other-revision')], 'revision'],
    ['already published draft', [{ ...draft('saved', 'a'), releasedAt: new Date() }], null],
  ])('rejects %s before changing delivery state', async (_, deliveries, editId) => {
    const { service, db } = setup(deliveries as any[]);
    await expect(service.deliverOrder(user, 'order', [], { savedDeliveryIds: ['saved'], editId: editId as string | null })).rejects.toThrow('saved files are no longer available');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('closes only the revision whose saved files are published', async () => {
    const { service, internals } = setup([draft('saved', 'a', 'revision')]);
    await service.deliverOrder(user, 'order', [], { savedDeliveryIds: ['saved'], editId: 'revision' });
    expect(internals.closeRevisionDesigns).toHaveBeenCalledWith('order', ['a'], 'revision');
  });

  it('blocks customer downloads of files that are still saved privately', async () => {
    const { service, db, internals } = setup([draft('saved', 'a')]);
    internals.getOrderRow.mockResolvedValue({ ...order, client_user_id: 'client' });
    db.queryOne.mockResolvedValue({ released_at: null } as any);
    await expect(service.getMyDeliveryFileSignedUrl({ id: 'client', role: 'CLIENT' } as any, 'order', 'saved-file')).rejects.toThrow('Delivery file not found');
  });

  it('keeps existing approval permissions when publishing saved files', async () => {
    const { service, db } = setup([draft('saved', 'a')]);
    await expect(service.deliverOrder({ id: 'designer', role: 'DESIGNER' } as any, 'order', [], {
      savedDeliveryIds: ['saved'],
    })).rejects.toThrow('Send for approval instead');
    expect(db.execute).not.toHaveBeenCalled();
  });
});
