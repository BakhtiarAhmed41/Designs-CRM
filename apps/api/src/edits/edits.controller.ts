import {
  Controller,
  Get,
  ForbiddenException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EditsService } from './edits.service';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class EditsController {
  constructor(private edits: EditsService) {}

  @Post(':id/request-edit')
  requestEdit() {
    throw new ForbiddenException('Revision requests are managed by our team.');
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
