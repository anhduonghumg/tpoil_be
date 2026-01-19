// src/modules/settlements/supplier-settlements/supplier-settlements.module.ts
import { Module } from '@nestjs/common'
import { SupplierSettlementsController } from './supplier-settlements.controller'
import { SupplierSettlementsService } from './supplier-settlements.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Module({
    controllers: [SupplierSettlementsController],
    providers: [SupplierSettlementsService, PrismaService],
    exports: [SupplierSettlementsService],
})
export class SupplierSettlementsModule {}
