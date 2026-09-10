import { Module } from '@nestjs/common'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { OpeningBalancesController } from './opening-balances.controller'
import { OpeningBalancesService } from './opening-balances.service'

@Module({
    controllers: [OpeningBalancesController],
    providers: [OpeningBalancesService, InventoryCoreService, PermissionsGuard],
})
export class OpeningBalancesModule {}
