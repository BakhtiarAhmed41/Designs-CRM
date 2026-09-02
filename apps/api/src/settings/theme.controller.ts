import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../common/enums';
import { themeColorsSchema } from './theme';
import { ThemeService } from './theme.service';

@Controller()
export class ThemeController {
  constructor(private theme: ThemeService) {}

  @Get('theme')
  async get() {
    return { colors: await this.theme.get() };
  }

  @Put('admin/theme')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  async save(@Body() body: unknown) {
    const colors = themeColorsSchema.parse(body);
    return { colors: await this.theme.save(colors) };
  }
}
