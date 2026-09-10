import { Module } from '@nestjs/common'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { CommercialLotsController } from './commercial-lots.controller'
import { CommercialLotsService } from './commercial-lots.service'

@Module({
    controllers: [CommercialLotsController],
    providers: [
        CommercialLotsService,
        GoodsReceiptPostingService,
        InventoryCoreService,
        PermissionsGuard,
    ],
    exports: [CommercialLotsService],
})
export class CommercialLotsModule {}
