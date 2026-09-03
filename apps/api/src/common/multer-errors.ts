import {
  BadRequestException,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

/** Shared limits for chat attachment uploads. */
export const MESSAGE_UPLOAD = {
  maxFiles: 8,
  maxFileSize: 25 * 1024 * 1024,
} as const;

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let message = 'File upload failed';
    if (exception.code === 'LIMIT_FILE_SIZE') {
      message = `File too large (max ${MESSAGE_UPLOAD.maxFileSize / (1024 * 1024)}MB)`;
    } else if (exception.code === 'LIMIT_FILE_COUNT') {
      message = `Too many files (max ${MESSAGE_UPLOAD.maxFiles})`;
    } else if (exception.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected file field';
    } else if (exception.message) {
      message = exception.message;
    }
    res.status(400).json({ statusCode: 400, message, error: 'Bad Request' });
  }
}

export function mapMulterFiles(files?: Express.Multer.File[]) {
  return (files ?? []).map((f) => {
    const raw = f.buffer as Buffer | Uint8Array | undefined;
    if (!raw || (typeof (raw as Buffer).length === 'number' && raw.length === 0 && f.size > 0)) {
      throw new BadRequestException(
        `Upload failed for "${f.originalname || 'file'}" - empty file buffer`,
      );
    }
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(raw ?? []);
    if (!buffer.length && !f.size) {
      throw new BadRequestException(
        `Upload failed for "${f.originalname || 'file'}" - empty file`,
      );
    }
    return {
      originalname: f.originalname || 'file',
      mimetype: f.mimetype,
      size: f.size || buffer.length,
      buffer,
    };
  });
}
