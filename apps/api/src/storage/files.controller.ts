import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LocalStorageService } from './local-storage.service';

function guessContentType(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return null;
}

/**
 * Public download endpoint. Access is authorized by the HMAC-signed token
 * embedded in the URL (created by LocalStorageService.createSignedUrl), so it
 * does not require a session - matching the previous signed-URL behavior.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly storage: LocalStorageService) {}

  @Get('download')
  download(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('name') name: string | undefined,
    @Query('inline') inlineFlag: string | undefined,
    @Res() res: Response,
  ) {
    if (!key || !exp || !sig) throw new BadRequestException('Missing token');
    const expNum = Number(exp);
    const inline = inlineFlag === '1';
    const verifyOk = this.storage.verify(key, expNum, sig, inline);
    if (!verifyOk) {
      throw new BadRequestException('Invalid or expired link');
    }
    const filename = name || key.split('/').pop() || 'download';
    const safeName = filename.replace(/"/g, '');
    let fileExists = true;
    try {
      this.storage.resolveExisting(key);
    } catch {
      fileExists = false;
    }
    const type = guessContentType(safeName) || guessContentType(key);
    if (!fileExists) {
      throw new BadRequestException('File not found');
    }
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
    );
    if (type) res.setHeader('Content-Type', type);
    const stream = this.storage.createStream(key);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
    });
    stream.pipe(res);
  }
}
