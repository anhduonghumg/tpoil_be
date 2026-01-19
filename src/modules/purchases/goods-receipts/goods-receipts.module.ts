// src/modules/purchases/goods-receipts/goods-receipts.module.ts
import { Module } from '@nestjs/common'
import { GoodsReceiptsController } from './goods-receipts.controller'
import { GoodsReceiptsService } from './goods-receipts.service'
import { InventoryService } from '../../inventory/inventory.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Module({
    controllers: [GoodsReceiptsController],
    providers: [GoodsReceiptsService, InventoryService, PrismaService],
    exports: [GoodsReceiptsService],
})
export class GoodsReceiptsModule {}
