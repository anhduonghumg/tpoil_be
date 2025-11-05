import { CustomersModule } from './modules/customers/customers.module';
import { CustomersController } from './modules/customers/customers.controller'
import { CustomersService } from './modules/customers/customers.service'
import { EmployeesModule } from './modules/employees/employees.module'
import { EmployeesController } from './modules/employees/employees.controller'
import { DepartmentsModule } from './modules/departments/departments.module'
import { DepartmentsController } from './modules/departments/departments.controller'
import { AuditModule } from './audit/audit.module'
import { AuditService } from './audit/audit.service'
import { PolicyService } from './rbac/policy.service'
import { RbacModule } from './rbac/rbac.module'
import { PrismaModule } from './infra/prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { AuthController } from './modules/auth/auth.controller'
import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AppLoggingModule } from './infra/logging/logging.module'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { DepartmentsService } from './modules/departments/departments.service'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'
import { UploadModule } from './modules/uploads/uploads.module'
import { ContractsController } from './modules/contracts/contracts.controller'
import { ContractsService } from './modules/contracts/contracts.service'
import { ContractsModule } from './modules/contracts/contracts.module'

@Module({
    imports: [
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
        EmployeesModule,
        ContractsModule,
        DepartmentsModule,
        AuditModule,
        RbacModule,
        PrismaModule,
        AuthModule,
        AppLoggingModule,
    ],
    controllers: [ContractsController, CustomersController, EmployeesController, DepartmentsController, AuthController, AppController],
    providers: [ContractsService, CustomersService, DepartmentsService, AuditService, PolicyService, AppService, LoggingInterceptor, AllExceptionsFilter],
})
export class AppModule {}
