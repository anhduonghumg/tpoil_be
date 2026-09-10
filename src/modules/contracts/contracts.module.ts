import { Module } from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { ContractTermsService } from './contract-terms.service'
import { ContractAppendicesService } from './contract-appendices.service'
import { ContractAppendicesController } from './contract-appendices.controller'
import { AuditModule } from 'src/audit/audit.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { ContractAttachmentsController } from './contract-attachments.controller'
import { ContractAttachmentsService } from './contract-attachments.service'
import { MailModule } from 'src/mail/mail.module'
import { CronModule } from '../cron/cron.module'
import { ContractExpiryCronService } from './cron/contract-expiry.cron.service'
import { ContractsCronRegister } from './cron/contracts-cron.register'
import { UploadModule } from '../uploads/uploads.module'

@Module({
    imports: [PrismaModule, MailModule, AuditModule, CronModule, UploadModule],
    controllers: [ContractsController, ContractAttachmentsController, ContractAppendicesController],
    providers: [ContractsService, ContractTermsService, ContractAppendicesService, ContractAttachmentsService, ContractExpiryCronService, ContractsCronRegister],
    exports: [ContractsService, ContractTermsService, ContractAttachmentsService],
})
export class ContractsModule {}
