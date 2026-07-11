import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  health(): { ok: true } {
    return { ok: true };
  }

  async healthDb(): Promise<{ ok: true; users: number }> {
    const users = await this.prisma.user.count();
    return { ok: true, users };
  }
}
