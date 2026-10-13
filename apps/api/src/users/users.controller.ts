import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { UsersService } from './users.service';

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(80).optional().nullable(),
  lastName: z.string().min(1).max(80).optional().nullable(),
  phone: z.string().min(3).max(30).optional().nullable(),
});

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me/photo')
  photo(@CurrentUser() user: AuthUser) {
    return this.users.getProfilePhoto(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.users.uploadProfilePhoto(user.id, file);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/photo')
  removePhoto(@CurrentUser() user: AuthUser) {
    return this.users.removeProfilePhoto(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.users.getById(user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto = updateProfileSchema.parse(body);
    return { user: await this.users.updateProfile(user.id, dto) };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/email')
  async changeEmail(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto = z.object({ email: z.string().email() }).parse(body);
    return this.users.requestEmailChange(user.id, dto.email);
  }
}
