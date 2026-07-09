// src/modules/app/app.module.ts
import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppBootstrapService } from './app-bootstrap.service'
import { ContractsModule } from '../contracts/contracts.module'
import { EmployeesModule } from '../employees/employees.module'
import { PrismaModule } from 'src/infra/prisma/prisma.module'

@Module({
    imports: [ContractsModule, EmployeesModule, PrismaModule],
    controllers: [AppController],
    providers: [AppBootstrapService],
    exports: [AppBootstrapService],
})
export class AppModule {}
