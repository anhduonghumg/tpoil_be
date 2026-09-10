// src/modules/purchases/goods-receipts/goods-receipts.module.ts
import { Module } from '@nestjs/common'
import { GoodsReceiptsController } from './goods-receipts.controller'
import { GoodsReceiptsService } from './goods-receipts.service'
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { SalesOrdersModule } from 'src/modules/sales/sales-orders.module'

@Module({
    imports: [SalesOrdersModule],
    controllers: [GoodsReceiptsController],
    providers: [
        GoodsReceiptsService,
        InventoryCoreService,
        GoodsReceiptPostingService,
        PermissionsGuard,
    ],
    exports: [GoodsReceiptsService],
})
export class GoodsReceiptsModule {}
