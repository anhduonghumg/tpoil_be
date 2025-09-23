import { Module } from '@nestjs/common'
import { DepartmentsController } from './departments.controller'
import { DepartmentsService } from './departments.service'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { AuditModule } from 'src/audit/audit.module'

@Module({
    imports: [PrismaModule, AuditModule],
    controllers: [DepartmentsController],
    providers: [DepartmentsService],
})
export class DepartmentsModule {}
