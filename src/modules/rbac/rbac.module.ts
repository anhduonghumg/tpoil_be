// src/modules/rbac/rbac.module.ts
import { Module } from '@nestjs/common'
import { RbacService } from './rbac.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SessionModule } from 'src/session/session.module'
import { RbacAdminService } from './rbac-admin.service'
import { RbacAdminController } from './rbac-admin.controller'

@Module({
    imports: [SessionModule],
    providers: [PrismaService, RbacService, RbacAdminService],
    controllers: [RbacAdminController],
    exports: [RbacService],
})
export class RbacModule {}
