import { Module } from '@nestjs/common'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { AuditModule } from 'src/audit/audit.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
    imports: [PrismaModule, AuditModule],
    controllers: [UsersController],
    providers: [UsersService],
    exports: [UsersService],
})
export class UsersModule {}
