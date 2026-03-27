import { Module } from '@nestjs/common'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'

import { PrismaModule } from './infra/prisma/prisma.module'
import { QueueModule } from './infra/queue/queue.module'

import { AppLoggingModule } from './infra/logging/logging.module'

import { LookupsModule } from './modules/lookups/lookups.module'
import { ContractTypesModule } from './modules/contract-types/contract-types.module'
import { CustomersModule } from './modules/customers/customers.module'
import { EmployeesModule } from './modules/employees/employees.module'
import { DepartmentsModule } from './modules/departments/departments.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { UploadModule } from './modules/uploads/uploads.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { ProductsModule } from './modules/products/products.module'
import { SupplierLocationsModule } from './modules/supplier-locations/supplier-locations.module'
import { PriceBulletinsModule } from './modules/price-bulletins/price-bulletins.module'
import { BankImportsModule } from './modules/banking/bank-imports/bank-imports.module'
import { PurchaseOrdersModule } from './modules/purchases/purchase-orders/purchase-orders.module'
import { GoodsReceiptsModule } from './modules/purchases/goods-receipts/goods-receipts.module'
import { SupplierInvoicesModule } from './modules/purchases/supplier-invoices/supplier-invoices.module'
import { SupplierSettlementsModule } from './modules/settlements/supplier-settlements.module'

import { BackgroundJobsModule } from './modules/background-jobs/background-jobs.module'
import { JobArtifactsModule } from './modules/job-artifacts/job-artifacts.module'

import { AppModule as AppFeatureModule } from './modules/app/app.module'

import { MailModule } from './mail/mail.module'
import { CronWebModule } from './modules/cron/cron-web.module'
import { CronModule } from './modules/cron/cron.module'
import { DevDriveTestModule } from './modules/test/dev-drive-test.module'
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module'
import { BankingModule } from './modules/banking/banking.module'
import { BankImportTemplatesModule } from './modules/bank-import-templates/bank-import-templates.module'

@Module({
    imports: [
        PrismaModule,
        QueueModule,
        AppLoggingModule,

        ServeStaticModule.forRoot({
            rootPath: join(process.cwd(), 'uploads'),
            serveRoot: '/static',
            serveStaticOptions: { index: false, fallthrough: false, etag: true },
        }),

        AppFeatureModule,

        LookupsModule,
        ContractTypesModule,
        CustomersModule,
        EmployeesModule,
        DepartmentsModule,
        AuthModule,
        UsersModule,
        UploadModule,
        ContractsModule,
        ProductsModule,
        SupplierLocationsModule,
        PriceBulletinsModule,

        BankingModule,
        BankImportsModule,
        BankAccountsModule,
        BankImportTemplatesModule,
        PurchaseOrdersModule,
        GoodsReceiptsModule,
        SupplierInvoicesModule,
        SupplierSettlementsModule,

        BackgroundJobsModule,
        JobArtifactsModule,
        CronWebModule,
        CronModule,

        DevDriveTestModule,

        MailModule,
    ],
})
export class WebModule {}
