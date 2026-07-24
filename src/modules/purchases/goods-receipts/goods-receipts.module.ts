// src/modules/purchases/goods-receipts/goods-receipts.module.ts
import { Module } from '@nestjs/common'
import { GoodsReceiptsController } from './goods-receipts.controller'
import { GoodsReceiptsService } from './goods-receipts.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'

@Module({
    controllers: [GoodsReceiptsController],
    providers: [
        GoodsReceiptsService,
        InventoryCoreService,
        GoodsReceiptPostingService,
        PrismaService,
    ],
    exports: [GoodsReceiptsService],
})
export class GoodsReceiptsModule {}
