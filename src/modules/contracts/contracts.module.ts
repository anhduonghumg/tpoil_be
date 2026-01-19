import { Module } from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { ContractAttachmentsController } from './contract-attachments.controller'
import { ContractAttachmentsService } from './contract-attachments.service'
import { MailModule } from 'src/mail/mail.module'
import { CronModule } from '../cron/cron.module'
import { ContractExpiryCronService } from './cron/contract-expiry.cron.service'
import { ContractsCronRegister } from './cron/contracts-cron.register'

@Module({
    imports: [PrismaModule, MailModule, AuditModule, CronModule],
    controllers: [ContractsController, ContractAttachmentsController],
    providers: [ContractsService, ContractAttachmentsService, PrismaService, ContractExpiryCronService, ContractsCronRegister],
    exports: [ContractsService, ContractAttachmentsService],
})
export class ContractsModule {}
