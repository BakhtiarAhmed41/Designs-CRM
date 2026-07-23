import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EditsService } from './edits.service';

const requestEditSchema = z.object({
  note: z.string().min(1),
});

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class EditsController {
  constructor(private edits: EditsService) {}

  @Post(':id/request-edit')
  async requestEdit(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = requestEditSchema.parse(body);
    const edit = await this.edits.clientRequestEdit(user, id, data);
    return { edit };
  }

  @Get(':id/edits')
  async listMine(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const edits = await this.edits.listMyEdits(user, id);
    return { edits };
  }
}
