// src/modules/purchases/purchase-orders/purchase-orders.module.ts
import { Module } from '@nestjs/common'
import { PurchaseOrdersController } from './purchase-orders.controller'
import { PurchaseOrdersService } from './purchase-orders.service'
import { ContractCheckService } from './contract-check.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Module({
    controllers: [PurchaseOrdersController],
    providers: [PurchaseOrdersService, ContractCheckService, PrismaService],
    exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
