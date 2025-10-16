import { Module } from '@nestjs/common'
import { EmployeesController } from './employees.controller'
import { EmployeesService } from './employees.service'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { AuditModule } from 'src/audit/audit.module'

@Module({
    imports: [PrismaModule, AuditModule],
    controllers: [EmployeesController],
    providers: [EmployeesService],
    exports: [EmployeesService],
})
export class EmployeesModule {}
