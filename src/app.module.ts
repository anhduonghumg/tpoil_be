import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { LookupsModule } from './modules/lookups/lookups.module'
import { LookupsController } from './modules/lookups/lookups.controller'
import { ContractTypesModule } from './modules/contract-types/contract-types.module'
import { ContractTypesController } from './modules/contract-types/contract-types.controller'
import { ContractTypesService } from './modules/contract-types/contract-types.service'
import { CustomersModule } from './modules/customers/customers.module'
import { EmployeesModule } from './modules/employees/employees.module'
import { EmployeesController } from './modules/employees/employees.controller'
import { DepartmentsModule } from './modules/departments/departments.module'
import { DepartmentsController } from './modules/departments/departments.controller'
import { AuditModule } from './audit/audit.module'
import { AuditService } from './audit/audit.service'
import { PrismaModule } from './infra/prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { AuthController } from './modules/auth/auth.controller'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AppLoggingModule } from './infra/logging/logging.module'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { DepartmentsService } from './modules/departments/departments.service'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'
import { UploadModule } from './modules/uploads/uploads.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { AppModule as AppFeatureModule } from './modules/app/app.module'
import { CronModule } from './modules/cron/cron.module'
import { MailModule } from './mail/mail.module'
import { UsersModule } from './modules/users/users.module'
import { BankImportsModule } from './modules/banking/bank-imports/bank-imports.module'
import { PurchaseOrdersModule } from './modules/purchases/purchase-orders/purchase-orders.module'
import { GoodsReceiptsModule } from './modules/purchases/goods-receipts/goods-receipts.module'
import { SupplierInvoicesModule } from './modules/purchases/supplier-invoices/supplier-invoices.module'
import { SupplierSettlementsModule } from './modules/settlements/supplier-settlements.module'
import { ProductsModule } from './modules/products/products.module'
import { SupplierLocationsModule } from './modules/supplier-locations/supplier-locations.module'
import { PriceBulletinsModule } from './modules/price-bulletins/price-bulletins.module'
import { BackgroundJobsModule } from './modules/background-jobs/background-jobs.module'
import { JobArtifactsModule } from './modules/job-artifacts/job-artifacts.module'

@Module({
    imports: [
        ScheduleModule.forRoot(),
        AppFeatureModule,
        LookupsModule,
        ContractTypesModule,
        CustomersModule,
        ServeStaticModule.forRoot(
            // {
            //     rootPath: join(__dirname, '..', 'client'),
            // },
            {
                rootPath: join(process.cwd(), 'uploads'),
                serveRoot: '/static',
                serveStaticOptions: {
                    index: false,
                    fallthrough: false,
                    etag: true,
                },
            },
        ),
        UploadModule,
        UsersModule,
        EmployeesModule,
        ContractsModule,
        DepartmentsModule,
        AuditModule,
        PrismaModule,
        AuthModule,
        AppLoggingModule,
        CronModule,
        MailModule,
        BankImportsModule,
        PurchaseOrdersModule,
        GoodsReceiptsModule,
        SupplierInvoicesModule,
        SupplierSettlementsModule,
        ProductsModule,
        SupplierLocationsModule,
        PriceBulletinsModule,
        BackgroundJobsModule,
        JobArtifactsModule,
    ],
    controllers: [LookupsController, ContractTypesController, EmployeesController, DepartmentsController, AuthController, AppController],
    providers: [ContractTypesService, DepartmentsService, AuditService, AppService, LoggingInterceptor, AllExceptionsFilter],
})
export class AppModule {}
