import { Module } from '@nestjs/common'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { OperationsController } from './operations.controller'
import { OperationsDashboardService } from './operations-dashboard.service'
import { WarehouseDashboardService } from './warehouse-dashboard.service'
import { RoadOperationsService } from './road-operations.service'
import { ShipCharterService } from './ship-charter.service'
import { WarehouseOperationsService } from './warehouse-operations.service'
import { CustomersModule } from 'src/modules/customers/customers.module'
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'

@Module({
    imports: [CustomersModule],
    controllers: [OperationsController],
    providers: [
        PrismaService,
        PermissionsGuard,
        InventoryCoreService,
        GoodsReceiptPostingService,
        ShipCharterService,
        WarehouseOperationsService,
        RoadOperationsService,
        OperationsDashboardService,
        WarehouseDashboardService,
    ],
    exports: [InventoryCoreService, GoodsReceiptPostingService],
})
export class OperationsModule {}
