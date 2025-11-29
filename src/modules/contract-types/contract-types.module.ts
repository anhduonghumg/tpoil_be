import { Module } from '@nestjs/common'
import { ContractTypesController } from './contract-types.controller'
import { ContractTypesService } from './contract-types.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'

@Module({
    imports: [PrismaModule, AuditModule],
    controllers: [ContractTypesController],
    providers: [ContractTypesService, PrismaService],
    exports: [ContractTypesService],
})
export class ContractTypesModule {}
