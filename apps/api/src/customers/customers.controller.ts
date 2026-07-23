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
import {
  AccountType,
  CustomerSource,
  NetTerms,
  STAFF_ROLES,
} from '../common/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { CustomersService } from './customers.service';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().min(3).max(60).optional().nullable(),
  accountType: z.nativeEnum(AccountType),
  netTerms: z.nativeEnum(NetTerms).optional().nullable(),
  source: z.nativeEnum(CustomerSource),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().min(3).max(60).optional().nullable(),
  accountType: z.nativeEnum(AccountType).optional(),
  netTerms: z.nativeEnum(NetTerms).optional().nullable(),
  source: z.nativeEnum(CustomerSource).optional(),
});

const mergeSchema = z.object({
  intoId: z.string().min(1),
});

const patchMeCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(3).max(60).optional().nullable(),
  preferences: z.any().optional(),
});

@Controller('admin/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class AdminCustomersController {
  constructor(private customers: CustomersService) {}

  @Get()
  async list(
    @Query('q') q: string | undefined,
    @Query('accountType') accountType: string | undefined,
  ) {
    const types = Object.values(AccountType) as string[];
    const parsedType =
      accountType && types.includes(accountType)
        ? (accountType as AccountType)
        : undefined;
    const customers = await this.customers.list({
      q: q?.trim() || undefined,
      accountType: parsedType,
    });
    return { customers };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const customer = await this.customers.detail(id);
    return { customer };
  }

  @Post()
  async create(@Body() body: unknown) {
    const data = createSchema.parse(body);
    const customer = await this.customers.create(data);
    return { customer };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const data = updateSchema.parse(body);
    const customer = await this.customers.update(id, data);
    return { customer };
  }

  @Post(':id/merge')
  async merge(@Param('id') id: string, @Body() body: unknown) {
    const { intoId } = mergeSchema.parse(body);
    const result = await this.customers.merge(id, intoId);
    return result;
  }
}

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeCustomerController {
  constructor(private customers: CustomersService) {}

  @Get('customer')
  async myCustomer(@CurrentUser() user: AuthUser) {
    const customer = await this.customers.getForUser(user.id);
    return { customer };
  }

  @Patch('customer')
  async patchMyCustomer(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = patchMeCustomerSchema.parse(body);
    const customer = await this.customers.updateForUser(user.id, data);
    return { customer };
  }
}
