import { Module } from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'

@Module({
    imports: [PrismaModule, AuditModule],
    controllers: [ContractsController],
    providers: [ContractsService, PrismaService],
    exports: [ContractsService],
})
export class ContractsModule {}
