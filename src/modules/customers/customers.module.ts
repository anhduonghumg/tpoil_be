import { Module } from '@nestjs/common'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'
import { CustomerOverviewService } from './customer-overview.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ContractsModule } from '../contracts/contracts.module'
import { CustomerAddressesController } from './customer-addresses.controller'
import { CustomerAddressesService } from './customer-addresses.service'
import { CustomerGroupsController } from './customer-groups.controller'
import { CustomerGroupsService } from './customer-groups.service'

@Module({
    imports: [PrismaModule, AuditModule, ContractsModule],
    controllers: [CustomersController, CustomerAddressesController, CustomerGroupsController],
    providers: [CustomersService, CustomerOverviewService, CustomerAddressesService, CustomerGroupsService, PrismaService],
    exports: [CustomersService],
})
export class CustomersModule {}
