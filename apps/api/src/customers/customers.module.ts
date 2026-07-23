import { Module } from '@nestjs/common';
import {
  AdminCustomersController,
  MeCustomerController,
} from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [AdminCustomersController, MeCustomerController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
