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

@Module({
    imports: [
        ServeStaticModule.forRoot(
            {
                rootPath: join(__dirname, '..', 'client'),
            },
            {
                rootPath: join(process.cwd(), 'uploads'),
                serveRoot: '/static',
            },
        ),
        EmployeesModule,
        DepartmentsModule,
        AuditModule,
        RbacModule,
        PrismaModule,
        AuthModule,
        AppLoggingModule,
    ],
    controllers: [EmployeesController, DepartmentsController, AuthController, AppController],
    providers: [DepartmentsService, AuditService, PolicyService, AppService, LoggingInterceptor, AllExceptionsFilter],
})
export class AppModule {}
