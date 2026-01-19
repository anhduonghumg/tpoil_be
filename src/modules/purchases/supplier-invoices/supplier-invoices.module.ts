// src/modules/purchases/supplier-invoices/supplier-invoices.module.ts
import { Module } from '@nestjs/common'
import { SupplierInvoicesController } from './supplier-invoices.controller'
import { SupplierInvoicesService } from './supplier-invoices.service'
import { InventoryService } from '../../inventory/inventory.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Module({
    controllers: [SupplierInvoicesController],
    providers: [SupplierInvoicesService, InventoryService, PrismaService],
    exports: [SupplierInvoicesService],
})
export class SupplierInvoicesModule {}
