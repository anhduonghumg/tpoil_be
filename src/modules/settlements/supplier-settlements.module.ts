// src/modules/settlements/supplier-settlements/supplier-settlements.module.ts
import { Module } from '@nestjs/common'
import { SupplierSettlementsController } from './supplier-settlements.controller'
import { SupplierSettlementsService } from './supplier-settlements.service'

@Module({
    controllers: [SupplierSettlementsController],
    providers: [SupplierSettlementsService],
    exports: [SupplierSettlementsService],
})
export class SupplierSettlementsModule {}
