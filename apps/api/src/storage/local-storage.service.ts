import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { createReadStream, existsSync, readdirSync, readFileSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'path';
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

function packageName(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

/** True for folders the Hostinger bundle deletes on every build. */
function isBuildOutput(dir: string): boolean {
  return /(?:^|[\\/])(?:dist|publish|\.tsc-out)(?:[\\/]|$)/.test(dir);
}

function walkForFile(dir: string, needle: string, depth: number): string | null {
  if (depth > 8 || !existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === needle) return full;
    if (entry.isDirectory()) {
      const nested = walkForFile(full, needle, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Local-disk file storage. Files live under UPLOAD_DIR keyed by a logical path.
 * Downloads use short-lived HMAC-signed URLs served by FilesController, keeping
 * the same "signed URL" contract the frontend already expects.
 */
@Injectable()
export class LocalStorageService {
  /**
   * apps/api, whether this code is running from src/, dist/storage/, or the
   * single-file bundle at dist/main.js or publish/main.js.
   */
  private apiPackageRoot(): string {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      if (packageName(dir) === '@designs-crm/api') return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return isBuildOutput(__dirname) ? resolve(__dirname, '..') : resolve(__dirname, '..', '..');
  }

  private configuredDir(): string | null {
    const configured = getEnv().UPLOAD_DIR;
    if (isAbsolute(configured)) return resolve(configured);
    return null;
  }

  /** Where new files are written. Never dist/ or publish/ — those are wiped on deploy. */
  private writeDir(): string {
    const absolute = this.configuredDir();
    if (absolute && !isBuildOutput(absolute)) return absolute;
    return resolve(this.apiPackageRoot(), 'uploads');
  }

  /** Every place an older build may have saved files, so existing images still open. */
  private readDirs(): string[] {
    const configured = getEnv().UPLOAD_DIR;
    const root = this.apiPackageRoot();
    const cwd = process.cwd();
    // Keep searching the default "uploads" folders even when UPLOAD_DIR is absolute.
    const relativeName = isAbsolute(configured) ? 'uploads' : configured;
    const dirs = [
      this.writeDir(),
      this.configuredDir(),
      resolve(root, 'uploads'),
      resolve(root, relativeName),
      // Repo-root /uploads. The bundled API (__dirname = apps/api/dist) used to write here.
      resolve(root, '..', 'uploads'),
      resolve(root, '..', relativeName),
      resolve(__dirname, '..', '..', 'uploads'),
      resolve(__dirname, '..', '..', relativeName),
      resolve(__dirname, '..', 'uploads'),
      resolve(cwd, 'uploads'),
      resolve(cwd, relativeName),
      resolve(cwd, 'apps', 'api', 'uploads'),
      resolve(cwd, 'apps', 'api', relativeName),
      resolve(root, 'dist', 'uploads'),
      resolve(root, 'publish', 'uploads'),
      resolve(root, '.uploads-keep-dist'),
      resolve(root, '.uploads-keep-publish'),
      resolve(cwd, 'dist', 'uploads'),
      resolve(cwd, 'publish', 'uploads'),
      resolve(cwd, '.uploads-keep-dist'),
      resolve(cwd, '.uploads-keep-publish'),
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const dir of dirs) {
      if (!dir) continue;
      const full = resolve(dir);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push(full);
    }
    return out;
  }

  private absPath(key: string, base = this.writeDir()): string {
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
    const normalizedKey = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const variants = [normalizedKey];
    if (normalizedKey.startsWith('uploads/')) {
      variants.push(normalizedKey.slice('uploads/'.length));
    }

    if (isAbsolute(key)) {
      const absolute = resolve(key);
      const underKnown = this.readDirs().some((dir) => {
        const root = resolve(dir);
        return absolute === root || absolute.startsWith(root + sep);
      });
      const inUploads = /(?:^|[\\/])uploads(?:[\\/]|$)/i.test(absolute);
      if (existsSync(absolute) && (underKnown || inUploads)) return absolute;
    }

    for (const base of this.readDirs()) {
      if (!existsSync(base)) continue;
      for (const variant of variants) {
        try {
          const full = this.absPath(variant, base);
          if (existsSync(full)) return full;
        } catch {
          /* skip invalid key for this base */
        }
      }
    }

    const baseName = normalizedKey.split('/').pop();
    if (baseName && baseName.length > 8) {
      const found = this.findByBasename(baseName);
      if (found) return found;
    }
    throw new InternalServerErrorException('File not found on disk');
  }

  /** Older builds sometimes stored the same file under a different folder prefix. */
  private findByBasename(baseName: string): string | null {
    const needle = baseName.toLowerCase();
    for (const dir of this.readDirs()) {
      const found = walkForFile(dir, needle, 0);
      if (found) return found;
    }
    return null;
  }

  createStream(key: string) {
    return createReadStream(this.resolveExisting(key));
  }

  async deleteObject(key: string): Promise<void> {
    try {
      const full = this.resolveExisting(key);
      if (existsSync(full)) await unlink(full);
    } catch {
      /* ignore missing or unreadable files */
    }
  }
}
