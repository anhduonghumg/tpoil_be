import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesProfitabilityService } from './sales-profitability.service'

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-profitability')
export class SalesProfitabilityController {
    constructor(private readonly service: SalesProfitabilityService) {}

    /** What a LOT/TERM purchase turned into: sold, remaining, revenue, cost, margin. */
    @Get('purchase-orders/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.sales.profitabilityView)
    purchaseSource(@Param('purchaseOrderId') purchaseOrderId: string) {
        return this.service.purchaseSourceReport(purchaseOrderId)
    }

    /** The same figures seen from a sale: which purchases fed it. */
    @Get('sales-orders/:salesOrderId')
    @RequirePermissions(PERMISSIONS.sales.profitabilityView)
    salesOrder(@Param('salesOrderId') salesOrderId: string) {
        return this.service.salesOrderProfitability(salesOrderId)
    }
}
