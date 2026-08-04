import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesReconciliationService } from './sales-reconciliation.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    ResolveReconciliationLineDto,
    UpdateReconciliationLineDto,
} from './dto/sales-reconciliation.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-reconciliations')
export class SalesReconciliationController {
    constructor(private readonly service: SalesReconciliationService) {}

    @Get('order/:salesOrderId')
    @RequirePermissions(PERMISSIONS.sales.view, PERMISSIONS.sales.reconcile)
    detailForOrder(@Param('salesOrderId') salesOrderId: string) {
        return this.service.detail({ salesOrderId })
    }

    @Get('withdrawal/:withdrawalRequestId')
    @RequirePermissions(PERMISSIONS.sales.view, PERMISSIONS.sales.reconcile)
    detailForWithdrawal(@Param('withdrawalRequestId') withdrawalRequestId: string) {
        return this.service.detail({ withdrawalRequestId })
    }

    @Post('lines/:lineId')
    @RequirePermissions(PERMISSIONS.sales.reconcile, PERMISSIONS.sales.deliveryConfirm)
    updateLine(
        @Param('lineId') lineId: string,
        @Body() dto: UpdateReconciliationLineDto,
        @Req() req: Request,
    ) {
        return this.service.updateLine(lineId, dto, actorFrom(req))
    }

    /** Accepts a variance with a reason; a large gap additionally needs exception authority. */
    @Post('lines/:lineId/resolve')
    @RequirePermissions(PERMISSIONS.sales.reconcile, PERMISSIONS.sales.approveException)
    resolveLine(
        @Param('lineId') lineId: string,
        @Body() dto: ResolveReconciliationLineDto,
        @Req() req: Request,
    ) {
        return this.service.resolveLine(lineId, dto, actorFrom(req))
    }
}
