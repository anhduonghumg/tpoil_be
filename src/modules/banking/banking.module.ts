import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infra/prisma/prisma.module'
import { BankingController } from './banking.controller'
import { BankingService } from './banking.service'
import { BankImportTemplatesModule } from '../bank-import-templates/bank-import-templates.module'
import { UploadModule } from '../uploads/uploads.module'
import { TermPaymentBatchesController } from './term-payment-batches.controller'
import { TermPaymentBatchesService } from './term-payment-batches.service'

@Module({
    imports: [PrismaModule, BankImportTemplatesModule, UploadModule],
    controllers: [BankingController, TermPaymentBatchesController],
    providers: [BankingService, TermPaymentBatchesService],
    exports: [BankingService, TermPaymentBatchesService],
})
export class BankingModule {}
