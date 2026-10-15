import { groupActivities, needsActivityAction } from './activity-groups';
import { NotificationsService } from './notifications.service';

const orderId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const user = { id: 'customer-user' } as any;
const date = (hour: number) => new Date(`2026-10-15T${String(hour).padStart(2, '0')}:00:00Z`);
const activity = (id: string, title: string, hour: number, extra = {}) => ({
  id, title, createdAt: date(hour), readAt: null, orderId, humanRef: '9127981442',
  completedAt: null, completionLabel: null, requiresAction: needsActivityAction(title), ...extra,
});
const notification = (id: string, title = 'New Message', extra = {}) => ({
  id, user_id: user.id, title, body: null, link: `/portal/messages?c=${conversationId}`,
  read_at: null, dismissed_at: null, completed_at: null, completion_label: null, created_at: date(10), ...extra,
});

describe('grouped customer activity', () => {
  it('combines messages for one order, retaining the latest timestamp/link and every member ID', () => {
    const groups = groupActivities([
      activity('older', 'New message', 9), activity('latest', 'New Message', 10),
      activity('other-order', 'New message', 11, { orderId: 'other' }),
      activity('files', 'Your files are ready', 8),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.find((n) => n.id === 'latest')).toMatchObject({ count: 2, notificationIds: ['latest', 'older'], createdAt: date(10) });
  });

  it('sorts unfinished actions first, then informational and completed rows by event time', () => {
    const groups = groupActivities([
      activity('info', 'Payment received', 15),
      activity('done', 'Quote updated', 14, { completedAt: date(16), completionLabel: 'Approved' }),
      activity('seen-action', 'Invoice ready', 12, { readAt: date(16) }),
      activity('message', 'New message', 13),
    ]);
    expect(groups.map((n) => n.id)).toEqual(['message', 'seen-action', 'info', 'done']);
  });

  it('reactivates the existing message group when a new message arrives after a reply', () => {
    const groups = groupActivities([
      activity('old', 'New message', 9, { completedAt: date(10), completionLabel: 'Replied', readAt: date(10) }),
      activity('new', 'New message', 11),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, completedAt: null, completionLabel: null, readAt: null });
  });

  it('keeps unresolved updates separate and distinguishes request notices from review actions', () => {
    expect(groupActivities([activity('one', 'New message', 9, { orderId: null, humanRef: null }), activity('two', 'New message', 10, { orderId: null, humanRef: null })])).toHaveLength(2);
    for (const title of ['Order started', 'Revision started', 'Quote request sent', 'Payment received', 'Account approved']) expect(needsActivityAction(title)).toBe(false);
    for (const title of ['Quote ready', 'Invoice ready', 'New message', 'Files ready', 'Revised files ready']) expect(needsActivityAction(title)).toBe(true);
  });

  function setup(items: ReturnType<typeof notification>[]) {
    const db = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM notifications')) return items;
        if (sql.includes('FROM conversations')) return [{ id: conversationId, order_id: orderId, name: 'Claude Logo', human_ref: '9127981442' }];
        if (sql.includes('FROM orders')) return [{ id: orderId, name: 'Claude Logo', human_ref: '9127981442' }];
        return [];
      }),
      queryOne: jest.fn(async () => ({ n: 0 })), execute: jest.fn(async () => ({})),
    };
    const events = { emitCreated: jest.fn() };
    return { db, events, service: new NotificationsService(db as any, events as any) };
  }

  it('groups before pagination, resolves chats to orders, and counts dismissed groups separately', async () => {
    const { service } = setup([
      ...Array.from({ length: 8 }, (_, i) => notification(`message-${i}`)),
      notification('payment', 'Payment received', { link: `/portal/orders/${orderId}` }),
      notification('dismissed-1', 'New Message', { dismissed_at: date(11) }),
      notification('dismissed-2', 'New Message', { dismissed_at: date(11) }),
    ]);
    const first = await service.list(user, { grouped: true, pageSize: 1 });
    expect(first.total).toBe(2);
    expect(first.totalPages).toBe(2);
    expect(first.dismissedCount).toBe(1);
    expect(first.notifications[0]).toMatchObject({ count: 8, designName: 'Claude Logo', requiresAction: true });
    const last = await service.list(user, { grouped: true, page: 99, pageSize: 1 });
    expect(last.page).toBe(2);
    expect(last.notifications[0].title).toBe('Payment received');
    const dismissed = await service.list(user, { grouped: true, dismissed: true });
    expect(dismissed.notifications[0]).toMatchObject({ count: 2 });
  });

  it.each(['dismiss', 'restore', 'read'] as const)('applies %s atomically to all group IDs with user ownership enforced', async (action) => {
    const { service, db } = setup([]);
    await service.updateBatch(user, ['one', 'two', 'one'], action);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0]).toEqual([expect.stringContaining('WHERE user_id = ? AND id IN (?,?)'), [user.id, 'one', 'two']]);
    expect(db.execute.mock.calls[0][0]).not.toContain('completed_at');
    await expect(service.updateBatch(undefined, ['one'], action)).rejects.toThrow();
  });

  it('completes replies only for the correct conversation and captures a cutoff for new messages', async () => {
    const { service, db } = setup([notification('message'), notification('other', 'New Message', { link: '/portal/messages?c=33333333-3333-4333-8333-333333333333' })]);
    const cutoff = date(12);
    await service.completeConversationReply(user.id, conversationId, cutoff);
    expect(db.execute.mock.calls[0]).toEqual([
      expect.stringContaining('completed_at IS NULL AND created_at <= ?'),
      [cutoff, 'Replied', cutoff, user.id, cutoff, 'message'],
    ]);
  });

  it('completes only quote actions for the matching order', async () => {
    const { service, db } = setup([
      notification('quote', 'Quote updated', { link: `/portal/quotes/${orderId}` }),
      notification('invoice', 'Invoice ready', { link: `/portal/orders/${orderId}` }),
      notification('other', 'Quote ready', { link: '/portal/quotes/33333333-3333-4333-8333-333333333333' }),
    ]);
    const cutoff = date(12);
    await service.completeOrderActivity(user.id, orderId, ['quote-ready', 'quote-updated'], 'Approved', cutoff);
    expect(db.execute.mock.calls[0][1]).toEqual([cutoff, 'Approved', cutoff, user.id, cutoff, 'quote']);
  });

  it('recovers prior actions from history without completing updates received afterward', async () => {
    const { service, db } = setup([]);
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM orders')) return [{ id: orderId, approved_at: date(12), status: 'IN_PROGRESS' }] as any;
      if (sql.includes('FROM messages')) return [{ order_id: orderId, acted_at: date(12) }] as any;
      if (sql.includes('FROM delivery_files')) return [{ order_id: orderId, acted_at: date(12) }] as any;
      if (sql.includes('FROM invoices')) return [{ id: 'invoice', order_id: orderId, status: 'PAID', paid_at: date(12) }] as any;
      return [];
    });
    const recovered = await (service as any).withActionHistory(user.id, [
      activity('quote', 'Quote ready', 10), activity('invoice', 'Invoice ready', 10),
      activity('message', 'New message', 10), activity('files', 'Files ready', 10),
      activity('new-message', 'New message', 13), activity('new-files', 'Files ready', 13),
    ]);
    expect(recovered.map((n: any) => n.completionLabel)).toEqual(['Approved', 'Paid', 'Replied', 'Downloaded', null, null]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('does not complete an order payment group while another invoice remains unpaid', async () => {
    const { service, db } = setup([]);
    db.query.mockImplementation(async (sql: string) => sql.includes('FROM invoices') ? [
      { id: 'paid', order_id: orderId, status: 'PAID', paid_at: date(12) },
      { id: 'unpaid', order_id: orderId, status: 'PARTIAL', paid_at: null },
    ] as any : []);
    const recovered = await (service as any).withActionHistory(user.id, [activity('invoice', 'Invoice ready', 10)]);
    expect(recovered[0].completedAt).toBeNull();
  });
});
