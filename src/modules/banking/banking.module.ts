import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infra/prisma/prisma.module'
import { BankingController } from './banking.controller'
import { BankingService } from './banking.service'
import { BankImportTemplatesModule } from '../bank-import-templates/bank-import-templates.module'
import { UploadModule } from '../uploads/uploads.module'
import { TermPaymentBatchesController } from './term-payment-batches.controller'
import { TermPaymentBatchesService } from './term-payment-batches.service'
import { GeneralPaymentRequestsController } from './general-payment-requests.controller'
import { GeneralPaymentRequestsService } from './general-payment-requests.service'
import { BankCounterpartyRecognizer } from './bank-counterparty-recognizer.service'
import { CommercialPaymentReconciliationService } from './commercial-payment-reconciliation.service'
import { CommercialPaymentsModule } from '../purchases/commercial-payments/commercial-payments.module'

@Module({
    imports: [PrismaModule, BankImportTemplatesModule, UploadModule, CommercialPaymentsModule],
    controllers: [BankingController, TermPaymentBatchesController, GeneralPaymentRequestsController],
    providers: [BankingService, TermPaymentBatchesService, GeneralPaymentRequestsService, BankCounterpartyRecognizer, CommercialPaymentReconciliationService],
    exports: [BankingService, TermPaymentBatchesService, BankCounterpartyRecognizer],
})
export class BankingModule {}
