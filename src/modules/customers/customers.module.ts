import { Module } from '@nestjs/common'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'

@Module({
    imports: [PrismaModule, AuditModule],
    controllers: [CustomersController],
    providers: [CustomersService],
    exports: [CustomersService],
})
export class CustomersModule {}
