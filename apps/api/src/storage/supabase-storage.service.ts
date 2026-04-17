import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getEnv } from '../config/env';

function sanitizeFilename(name: string): string {
  // Keep it simple and stable: no path separators, no weird control chars.
  return name.replace(/[\\/\u0000-\u001F\u007F]+/g, '_').slice(0, 200) || 'file';
}

@Injectable()
export class SupabaseStorageService {
  private client: SupabaseClient;

  constructor() {
    const env = getEnv();
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  getOrdersBucket(): string {
    return getEnv().SUPABASE_ORDERS_BUCKET;
  }

  makeKey(parts: string[]): string {
    const safe = parts.map((p) => p.replace(/\/+/g, '_'));
    return safe.join('/');
  }

  newObjectKey(prefixParts: string[], originalName: string): string {
    const base = sanitizeFilename(originalName);
    return this.makeKey([...prefixParts, `${randomUUID()}-${base}`]);
  }

  async uploadObject(opts: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<void> {
    const { error } = await this.client.storage.from(opts.bucket).upload(opts.key, opts.body, {
      contentType: opts.contentType,
      upsert: false,
    });
    if (error) {
      throw new InternalServerErrorException(`Upload failed: ${error.message}`);
    }
  }

  async createSignedUrl(opts: {
    bucket: string;
    key: string;
    expiresInSeconds?: number;
    /** Suggested filename; Supabase sets Content-Disposition: attachment so browsers download instead of previewing. */
    downloadAs?: string;
  }): Promise<string> {
    const env = getEnv();
    const ttl = opts.expiresInSeconds ?? env.STORAGE_SIGNED_URL_TTL_SECONDS;
    const downloadName = opts.downloadAs ? sanitizeFilename(opts.downloadAs) : undefined;
    const { data, error } = downloadName
      ? await this.client.storage.from(opts.bucket).createSignedUrl(opts.key, ttl, { download: downloadName })
      : await this.client.storage.from(opts.bucket).createSignedUrl(opts.key, ttl);
    if (error || !data?.signedUrl) {
      throw new InternalServerErrorException(`Could not create signed URL${error ? `: ${error.message}` : ''}`);
    }
    return data.signedUrl;
  }
}

