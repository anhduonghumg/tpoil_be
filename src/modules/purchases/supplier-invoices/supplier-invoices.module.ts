import { Module } from '@nestjs/common'
import { SupplierInvoicesController } from './supplier-invoices.controller'
import { SupplierInvoicesService } from './supplier-invoices.service'
import { GoodsReceiptPostingService } from '../../inventory/goods-receipt-posting.service'
import { InventoryCoreService } from '../../inventory/inventory-core.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { GoogleDriveModule } from 'src/infra/google-drive/google-drive.module'
import { BackgroundJobsModule } from 'src/modules/background-jobs/background-jobs.module'
import { JobArtifactsModule } from 'src/modules/job-artifacts/job-artifacts.module'

@Module({
    imports: [GoogleDriveModule, BackgroundJobsModule, JobArtifactsModule],
    controllers: [SupplierInvoicesController],
    providers: [SupplierInvoicesService, InventoryCoreService, GoodsReceiptPostingService, PrismaService],
    exports: [SupplierInvoicesService],
})
export class SupplierInvoicesModule {}
