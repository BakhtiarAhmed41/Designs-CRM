import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums';
import { SearchService } from './search.service';

@Controller('admin/search')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPPORT, UserRole.DESIGNER)
export class SearchController {
  constructor(private search: SearchService) {}

  @Get()
  async run(
    @CurrentUser() user: AuthUser | undefined,
    @Query('q') q: string | undefined,
  ) {
    return this.search.search(user, q);
  }
}
