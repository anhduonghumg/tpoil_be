import { Module } from '@nestjs/common'
import { SupplierInvoicesController } from './supplier-invoices.controller'
import { SupplierInvoicesService } from './supplier-invoices.service'
import { InventoryService } from '../../inventory/inventory.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { GoogleDriveModule } from 'src/infra/google-drive/google-drive.module'
import { BackgroundJobsModule } from 'src/modules/background-jobs/background-jobs.module'
import { JobArtifactsModule } from 'src/modules/job-artifacts/job-artifacts.module'

@Module({
    imports: [GoogleDriveModule, BackgroundJobsModule, JobArtifactsModule],
    controllers: [SupplierInvoicesController],
    providers: [SupplierInvoicesService, InventoryService, PrismaService],
    exports: [SupplierInvoicesService],
})
export class SupplierInvoicesModule {}
