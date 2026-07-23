import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LocalStorageService } from './local-storage.service';

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
    @Res() res: Response,
  ) {
    if (!key || !exp || !sig) throw new BadRequestException('Missing token');
    const expNum = Number(exp);
    if (!this.storage.verify(key, expNum, sig)) {
      throw new BadRequestException('Invalid or expired link');
    }
    const filename = name || key.split('/').pop() || 'download';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/"/g, '')}"`,
    );
    const stream = this.storage.createStream(key);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
    });
    stream.pipe(res);
  }
}
