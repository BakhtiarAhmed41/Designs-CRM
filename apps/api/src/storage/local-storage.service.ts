import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join, normalize, resolve, sep } from 'path';
import { getEnv } from '../config/env';

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/\u0000-\u001F\u007F]+/g, '_')
      .replace(/[<>:"|?*']/g, '_')
      .slice(0, 200) || 'file'
  );
}

function signSecret(): string {
  const env = getEnv();
  return env.STORAGE_URL_SECRET || env.JWT_ACCESS_SECRET;
}

/**
 * Local-disk file storage. Files live under UPLOAD_DIR keyed by a logical path.
 * Downloads use short-lived HMAC-signed URLs served by FilesController, keeping
 * the same "signed URL" contract the frontend already expects.
 */
@Injectable()
export class LocalStorageService {
  private candidateDirs(): string[] {
    const configured = getEnv().UPLOAD_DIR;
    if (configured.startsWith('/') || /^[A-Za-z]:[\\/]/.test(configured)) {
      return [resolve(configured)];
    }
    return [
      resolve(process.cwd(), configured),
      resolve(process.cwd(), 'apps', 'api', configured),
      // Compiled: dist/storage → apps/api/uploads
      resolve(__dirname, '..', '..', configured),
    ];
  }

  private baseDir(): string {
    const candidates = this.candidateDirs();
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return candidates[candidates.length - 1];
  }

  private absPath(key: string, base = this.baseDir()): string {
    const full = normalize(join(base, key));
    if (full !== base && !full.startsWith(base + sep)) {
      throw new InternalServerErrorException('Invalid storage key');
    }
    return full;
  }

  makeKey(parts: string[]): string {
    return parts.map((p) => p.replace(/[\\/]+/g, '_')).join('/');
  }

  newObjectKey(prefixParts: string[], originalName: string): string {
    const base = sanitizeFilename(originalName);
    return this.makeKey([...prefixParts, `${randomUUID()}-${base}`]);
  }

  async uploadObject(opts: {
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<void> {
    const full = this.absPath(opts.key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, opts.body);
  }

  private sign(key: string, exp: number, inline = false): string {
    return createHmac('sha256', signSecret())
      .update(inline ? `${key}\n${exp}\ninline` : `${key}\n${exp}`)
      .digest('hex');
  }

  verify(key: string, exp: number, sig: string, inline = false): boolean {
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = this.sign(key, exp, inline);
    return expected === sig;
  }

  /**
   * Returns a relative URL under the API (/api/files/download?...) with a signed
   * token. The frontend resolves it against the API origin.
   */
  async createSignedUrl(opts: {
    key: string;
    expiresInSeconds?: number;
    downloadAs?: string;
    inline?: boolean;
  }): Promise<string> {
    const env = getEnv();
    const ttl = opts.expiresInSeconds ?? env.STORAGE_SIGNED_URL_TTL_SECONDS;
    const exp = Date.now() + ttl * 1000;
    const inline = Boolean(opts.inline);
    const sig = this.sign(opts.key, exp, inline);
    const params = new URLSearchParams({
      key: opts.key,
      exp: String(exp),
      sig,
    });
    if (inline) params.set('inline', '1');
    if (opts.downloadAs) params.set('name', sanitizeFilename(opts.downloadAs));
    return `/api/files/download?${params.toString()}`;
  }

  resolveExisting(key: string): string {
    const dirs = this.candidateDirs();
    for (const base of dirs) {
      if (!existsSync(base)) continue;
      try {
        const full = this.absPath(key, base);
        if (existsSync(full)) return full;
      } catch {
        /* skip invalid key for this base */
      }
    }
    throw new InternalServerErrorException('File not found on disk');
  }

  createStream(key: string) {
    return createReadStream(this.resolveExisting(key));
  }

  async deleteObject(key: string): Promise<void> {
    try {
      const full = this.absPath(key);
      if (existsSync(full)) await unlink(full);
    } catch {
      /* ignore missing or unreadable files */
    }
  }
}
