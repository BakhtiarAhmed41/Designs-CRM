import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireFeatures } from '../auth/decorators/features.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeaturesGuard } from '../auth/guards/features.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EditKind, EditStatus, UserRole } from '../common/enums';
import { EditsService } from './edits.service';

const createEditSchema = z.object({
  note: z.string().min(1),
  kind: z.enum([EditKind.FREE, EditKind.PAID]),
  priceCents: z.number().int().nonnegative().optional().nullable(),
  designId: z.string().optional().nullable(),
  assignedDesignerId: z.string().optional().nullable(),
});

const updateEditSchema = z.object({
  status: z.enum([EditStatus.PENDING, EditStatus.DONE]).optional(),
  assignedDesignerId: z.string().optional().nullable(),
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, FeaturesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT, UserRole.DESIGNER)
@RequireFeatures('edits')
export class AdminEditsController {
  constructor(private edits: EditsService) {}

  @Post('orders/:id/edits')
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = createEditSchema.parse(body);
    const edit = await this.edits.createEdit(user, id, data);
    return { edit };
  }

  @Get('edits')
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('status') status: string | undefined,
    @Query('q') q: string | undefined,
  ) {
    const statuses = Object.values(EditStatus) as string[];
    const parsed =
      status && statuses.includes(status) ? (status as EditStatus) : undefined;
    const edits = await this.edits.listEdits(user, {
      status: parsed,
      q: q?.trim() || undefined,
    });
    return { edits };
  }

  @Patch('edits/:id')
  async update(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = updateEditSchema.parse(body);
    const edit = await this.edits.updateEdit(user, id, data);
    return { edit };
  }

  @Get('orders/:id/activity')
  async activity(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const activity = await this.edits.getActivity(user, id);
    return { activity };
  }
}
