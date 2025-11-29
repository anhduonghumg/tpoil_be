import { Module } from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { ContractAttachmentsController } from './contract-attachments.controller'
import { ContractAttachmentsService } from './contract-attachments.service'

@Module({
    imports: [PrismaModule, AuditModule],
    controllers: [ContractsController, ContractAttachmentsController],
    providers: [ContractsService, ContractAttachmentsService, PrismaService],
    exports: [ContractsService, ContractAttachmentsService],
})
export class ContractsModule {}
