import { UsersService } from './users.service';

describe('Profile photos', () => {
  function setup(previous: string | null = 'old-photo') {
    const db = {
      queryOne: jest.fn().mockResolvedValue({ profile_image_key: previous }),
      execute: jest.fn().mockResolvedValue({}),
    };
    const storage = {
      newObjectKey: jest.fn().mockReturnValue('new-photo'),
      uploadObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      createSignedUrl: jest.fn().mockResolvedValue('/signed-photo'),
    };
    return {
      db,
      storage,
      service: new UsersService(db as any, {} as any, storage as any),
    };
  }
  const png = {
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    originalname: 'untrusted.svg',
    mimetype: 'text/plain',
  } as Express.Multer.File;

  it('persists a photo under the authenticated user and removes the replaced file', async () => {
    const { service, storage, db } = setup();
    expect(await service.uploadProfilePhoto('user-a', png)).toEqual({
      url: '/signed-photo',
    });
    expect(storage.newObjectKey).toHaveBeenCalledWith(
      ['users', 'user-a', 'profile'],
      'photo.png',
    );
    expect(storage.uploadObject).toHaveBeenCalledWith({
      key: 'new-photo',
      body: png.buffer,
      contentType: 'image/png',
    });
    expect(db.execute).toHaveBeenCalledWith(
      'UPDATE users SET profile_image_key = ? WHERE id = ?',
      ['new-photo', 'user-a'],
    );
    expect(storage.deleteObject).toHaveBeenCalledWith('old-photo');
  });
  it('retrieves the stored image with an inline signed URL', async () => {
    const { service, db, storage } = setup();
    expect(await service.getProfilePhoto('user-a')).toEqual({
      url: '/signed-photo',
    });
    expect(db.queryOne).toHaveBeenCalledWith(expect.any(String), ['user-a']);
    expect(storage.createSignedUrl).toHaveBeenCalledWith({
      key: 'old-photo',
      inline: true,
    });
  });
  it('returns initials state when no photo is stored', async () => {
    const { service, storage } = setup(null);
    expect(await service.getProfilePhoto('user-a')).toEqual({ url: null });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it('rejects missing, non-image and oversized uploads without changing the current image', async () => {
    const { service, db, storage } = setup();
    await expect(service.uploadProfilePhoto('user-a')).rejects.toThrow(
      'Choose a profile photo',
    );
    await expect(
      service.uploadProfilePhoto('user-a', {
        ...png,
        buffer: Buffer.from('<svg />'),
      }),
    ).rejects.toThrow('PNG, JPG or WebP');
    await expect(
      service.uploadProfilePhoto('user-a', {
        ...png,
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow('5 MB');
    expect(db.execute).not.toHaveBeenCalled();
    expect(storage.uploadObject).not.toHaveBeenCalled();
  });
  it('preserves the old photo and cleans the new upload if saving fails', async () => {
    const { service, db, storage } = setup();
    db.execute.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.uploadProfilePhoto('user-a', png)).rejects.toThrow(
      'Database unavailable',
    );
    expect(storage.deleteObject).toHaveBeenCalledWith('new-photo');
    expect(storage.deleteObject).not.toHaveBeenCalledWith('old-photo');
  });
  it('removes the persisted image and does not delete a file if the database update fails', async () => {
    const { service, db, storage } = setup();
    db.execute.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.removeProfilePhoto('user-a')).rejects.toThrow(
      'Database unavailable',
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(await service.removeProfilePhoto('user-a')).toEqual({ url: null });
    expect(db.execute).toHaveBeenCalledWith(
      'UPDATE users SET profile_image_key = NULL WHERE id = ?',
      ['user-a'],
    );
    expect(storage.deleteObject).toHaveBeenCalledWith('old-photo');
  });
});
