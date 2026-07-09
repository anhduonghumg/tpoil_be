import { Module } from '@nestjs/common'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryService } from 'src/modules/inventory/inventory.service'
import { OperationsController } from './operations.controller'
import { OperationsDashboardService } from './operations-dashboard.service'
import { RoadOperationsService } from './road-operations.service'
import { ShipCharterService } from './ship-charter.service'
import { WarehouseAvailabilityService } from './warehouse-availability.service'
import { WarehouseOperationsService } from './warehouse-operations.service'

@Module({
    controllers: [OperationsController],
    providers: [
        PrismaService,
        PermissionsGuard,
        InventoryService,
        WarehouseAvailabilityService,
        ShipCharterService,
        WarehouseOperationsService,
        RoadOperationsService,
        OperationsDashboardService,
    ],
    exports: [WarehouseAvailabilityService],
})
export class OperationsModule {}
