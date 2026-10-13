import { CustomersService } from './customers.service';
import { AdminCustomersController } from './customers.controller';
import { UserRole } from '../common/enums';

describe('Admin customer photos', () => {
  function setup(key: string | null = 'users/customer-user/profile/photo.png') {
    const db = { queryOne: jest.fn().mockResolvedValue({ profile_image_key: key }) };
    const storage = { createSignedUrl: jest.fn().mockResolvedValue('/signed-customer-photo') };
    const service = new CustomersService(db as any, storage as any);
    return { db, storage, service };
  }
  it('uses the requested customer’s linked user photo, not the staff account', async () => {
    const { db, storage, service } = setup();
    expect(await service.profilePhoto('customer-a')).toEqual({ url: '/signed-customer-photo' });
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('u.id = c.user_id'), ['customer-a']);
    expect(storage.createSignedUrl).toHaveBeenCalledWith({ key: 'users/customer-user/profile/photo.png', inline: true });
  });
  it('returns no photo for a guest or customer without an upload', async () => {
    const { service, storage } = setup(null);
    expect(await service.profilePhoto('guest')).toEqual({ url: null });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it('rejects missing customers', async () => {
    const { service, db } = setup();
    db.queryOne.mockResolvedValueOnce(null);
    await expect(service.profilePhoto('missing')).rejects.toThrow('Customer not found');
  });
  it('keeps customer identity hidden from designers', () => {
    const { service } = setup();
    const controller = new AdminCustomersController(service);
    expect(() => controller.photo({ role: UserRole.DESIGNER } as any, 'customer-a')).toThrow('Customer details are hidden');
  });
});
