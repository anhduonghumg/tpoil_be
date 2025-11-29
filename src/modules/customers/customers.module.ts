import { Module } from '@nestjs/common'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'
import { CustomerOverviewService } from './customer-overview.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ContractsModule } from '../contracts/contracts.module'

@Module({
    imports: [PrismaModule, AuditModule, ContractsModule],
    controllers: [CustomersController],
    providers: [CustomersService, CustomerOverviewService, PrismaService],
    exports: [CustomersService],
})
export class CustomersModule {}
