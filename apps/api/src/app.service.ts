import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health(): { ok: true } {
    return { ok: true };
  }
}
