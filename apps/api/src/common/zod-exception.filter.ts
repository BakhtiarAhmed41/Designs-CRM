import {
  Catch,
  BadRequestException,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { Response } from 'express';

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const message = exception.issues
      .map((i) => {
        const path = i.path.length ? `${i.path.join('.')}: ` : '';
        return `${path}${i.message}`;
      })
      .join(', ');
    const body = new BadRequestException(message || 'Validation failed').getResponse();
    res.status(400).json(body);
  }
}
