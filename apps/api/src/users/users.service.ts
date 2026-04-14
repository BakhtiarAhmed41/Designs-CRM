import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(
    id: string,
    data: { firstName?: string | null; lastName?: string | null; phone?: string | null },
  ) {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: data.firstName === undefined ? undefined : data.firstName,
        lastName: data.lastName === undefined ? undefined : data.lastName,
        phone: data.phone === undefined ? undefined : data.phone,
      },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true, createdAt: true, updatedAt: true },
    });
    return user;
  }
}

