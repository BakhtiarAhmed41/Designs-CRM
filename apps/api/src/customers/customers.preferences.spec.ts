import { CustomersService } from './customers.service';

describe('customer file preferences', () => {
  const preferences = { embFormats: ['DST', 'PES'], cncFormats: ['STL', '3MF'], portalLook: { headingColor: '#222222' } };

  it.each([preferences, JSON.stringify(preferences)])('returns saved formats as an object for native JSON and text JSON', async (stored) => {
    const db = { queryOne: jest.fn().mockResolvedValue({ id: 'customer', preferences: stored }) };
    const service = new CustomersService(db as any, {} as any);
    expect((await service.getForUser('user'))?.preferences).toEqual(preferences);
  });

  it.each(['invalid json', 'null', '[]', null])('handles missing or invalid saved preferences without breaking the form', async (stored) => {
    const db = { queryOne: jest.fn().mockResolvedValue({ id: 'customer', preferences: stored }) };
    const service = new CustomersService(db as any, {} as any);
    expect((await service.getForUser('user'))?.preferences).toBeNull();
  });
});
