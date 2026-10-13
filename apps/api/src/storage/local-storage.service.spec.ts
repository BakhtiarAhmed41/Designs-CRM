import { Logger } from '@nestjs/common';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { getEnv } from '../config/env';
import { LocalStorageService } from './local-storage.service';

jest.mock('../config/env', () => ({ getEnv: jest.fn() }));

describe('Upload storage across deployments', () => {
  let temp: string;
  let root: string;
  const key = 'users/test/profile/photo.png';
  const body = Buffer.from('original image bytes');
  const env = {
    NODE_ENV: 'production', UPLOAD_DIR: 'uploads',
    JWT_ACCESS_SECRET: 'stable-secret-for-tests',
    STORAGE_SIGNED_URL_TTL_SECONDS: 3600,
  };

  function service(packageRoot = root) {
    const storage = new LocalStorageService();
    jest.spyOn(storage as any, 'apiPackageRoot').mockReturnValue(packageRoot);
    return storage;
  }

  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), 'crm-storage-'));
    root = join(temp, 'release-a', 'apps', 'api');
    await mkdir(root, { recursive: true });
    jest.mocked(getEnv).mockReturnValue({ ...env } as ReturnType<typeof getEnv>);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(temp, { recursive: true, force: true });
  });

  it('keeps the same files and signed links after the entire release is replaced', async () => {
    const persistent = join(temp, 'persistent', 'uploads');
    jest.mocked(getEnv).mockReturnValue({ ...env, UPLOAD_DIR: persistent } as ReturnType<typeof getEnv>);
    const old = service();
    await old.onModuleInit();
    await old.uploadObject({ key, body });
    const url = new URL(await old.createSignedUrl({ key, inline: true }), 'https://api.example.com');
    await rm(join(temp, 'release-a'), { recursive: true });
    const next = service(join(temp, 'release-b', 'apps', 'api'));
    await next.onModuleInit();
    expect(await readFile(next.resolveExisting(key))).toEqual(body);
    expect(next.verify(key, Number(url.searchParams.get('exp')), url.searchParams.get('sig')!, true)).toBe(true);
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('honors a custom relative upload directory and warns about production persistence', async () => {
    jest.mocked(getEnv).mockReturnValue({ ...env, UPLOAD_DIR: 'customer-files' } as ReturnType<typeof getEnv>);
    const storage = service();
    await storage.onModuleInit();
    await storage.uploadObject({ key, body });
    expect(await readFile(join(root, 'customer-files', key))).toEqual(body);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('still reads files written to the old default after changing UPLOAD_DIR', async () => {
    const oldPath = join(root, 'uploads', key);
    await mkdir(dirname(oldPath), { recursive: true });
    await writeFile(oldPath, body);
    jest.mocked(getEnv).mockReturnValue({ ...env, UPLOAD_DIR: join(temp, 'persistent') } as ReturnType<typeof getEnv>);
    expect(await readFile(service().resolveExisting(key))).toEqual(body);
  });

  it.each(['dist/uploads', 'publish/uploads', '.tsc-out/uploads'])(
    'rejects unsafe build storage %s instead of silently ignoring it', async (UPLOAD_DIR) => {
      jest.mocked(getEnv).mockReturnValue({ ...env, UPLOAD_DIR } as ReturnType<typeof getEnv>);
      await expect(service().onModuleInit()).rejects.toThrow('UPLOAD_DIR must be outside');
    },
  );
});
