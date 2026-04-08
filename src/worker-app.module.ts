import { Module } from '@nestjs/common'
import { PrismaModule } from './infra/prisma/prisma.module'
import { QueueModule } from './infra/queue/queue.module'
import { AppLoggingModule } from './infra/logging/logging.module'

import { BackgroundJobsModule } from './modules/background-jobs/background-jobs.module'
import { JobArtifactsModule } from './modules/job-artifacts/job-artifacts.module'
import { PriceBulletinsModule } from './modules/price-bulletins/price-bulletins.module'
import { CronWorkerModule } from './modules/cron/cron-worker.module'
import { MailModule } from './mail/mail.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { CronModule } from './modules/cron/cron.module'
import { PriceBulletinsWorkerModule } from './modules/price-bulletins/price-bulletins.worker.module'
import { SupplierInvoicesWorkerModule } from './modules/purchases/supplier-invoices/supplier-invoices.worker.module'
import { PurchaseOrdersWorkerModule } from './modules/purchases/purchase-orders/purchase-orders.worker.module'

@Module({
    imports: [
        PrismaModule,
        QueueModule,
        AppLoggingModule,
        PriceBulletinsModule,
        CronWorkerModule,
        CronModule,
        MailModule,
        ContractsModule,
        SupplierInvoicesWorkerModule,

        BackgroundJobsModule,
        JobArtifactsModule,
        PriceBulletinsWorkerModule,
        PurchaseOrdersWorkerModule,
    ],
})
export class WorkerModule {}
