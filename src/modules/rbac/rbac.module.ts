// src/modules/rbac/rbac.module.ts
import { Module } from '@nestjs/common'
import { RbacService } from './rbac.service'
import { SessionModule } from 'src/session/session.module'
import { RbacAdminService } from './rbac-admin.service'
import { RbacAdminController } from './rbac-admin.controller'

@Module({
    imports: [SessionModule],
    providers: [RbacService, RbacAdminService],
    controllers: [RbacAdminController],
    exports: [RbacService],
})
export class RbacModule {}
