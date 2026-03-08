import { Module } from '@nestjs/common'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { QueueModule } from 'src/infra/queue/queue.module'
import { GoogleDriveModule } from 'src/infra/google-drive/google-drive.module'
import { BackgroundJobsModule } from 'src/modules/background-jobs/background-jobs.module'
import { JobArtifactsModule } from 'src/modules/job-artifacts/job-artifacts.module'
import { InventoryService } from 'src/modules/inventory/inventory.service'

import { SupplierInvoicesService } from './supplier-invoices.service'
import { SupplierInvoiceProcessor } from './jobs/supplier-invoice.processor'
import { SupplierInvoiceWorker } from './supplier-invoice-worker.listener'

@Module({
    imports: [PrismaModule, QueueModule, GoogleDriveModule, BackgroundJobsModule, JobArtifactsModule],
    providers: [SupplierInvoicesService, InventoryService, SupplierInvoiceProcessor, SupplierInvoiceWorker],
})
export class SupplierInvoicesWorkerModule {}
