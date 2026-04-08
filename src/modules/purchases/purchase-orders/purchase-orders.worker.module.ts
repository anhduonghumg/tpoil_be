import { Module } from '@nestjs/common'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { QueueModule } from 'src/infra/queue/queue.module'
import { PurchaseOrdersService } from './purchase-orders.service'
import { PurchaseOrderPrintProcessor } from './jobs/purchase-order-print.processor'
import { PurchaseOrdersWorker } from './purchase-orders.worker.listener'
import { BackgroundJobsModule } from 'src/modules/background-jobs/background-jobs.module'
import { JobArtifactsModule } from 'src/modules/job-artifacts/job-artifacts.module'
import { ContractCheckService } from './contract-check.service'

@Module({
    imports: [PrismaModule, BackgroundJobsModule, JobArtifactsModule, QueueModule],
    providers: [PurchaseOrdersService, PurchaseOrderPrintProcessor, PurchaseOrdersWorker, ContractCheckService],
})
export class PurchaseOrdersWorkerModule {}
