import { Module } from '@nestjs/common'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { OpeningBalancesController } from './opening-balances.controller'
import { OpeningBalancesService } from './opening-balances.service'

@Module({
    controllers: [OpeningBalancesController],
    providers: [OpeningBalancesService, InventoryCoreService, PrismaService, PermissionsGuard],
})
export class OpeningBalancesModule {}
