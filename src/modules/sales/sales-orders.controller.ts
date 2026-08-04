import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { SalesOrderKind } from '@prisma/client'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesOrdersService } from './sales-orders.service'
import { SalesOrderWorkflowService, SalesActor } from './sales-order-workflow.service'
import {
    CancelSalesOrderDto,
    CreateSalesOrderDto,
    CreateSalesOrderFromPurchaseDto,
    ListSalesOrdersQueryDto,
    UpdateSalesOrderDto,
} from './dto/sales-order.dto'

function actorFrom(req: Request): SalesActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-orders')
export class SalesOrdersController {
    constructor(
        private readonly service: SalesOrdersService,
        private readonly workflow: SalesOrderWorkflowService,
    ) {}

    @Get()
    list(@Query() query: ListSalesOrdersQueryDto) {
        return this.service.list(query)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    /** Single create endpoint dispatching by kind (spec v1.2 §14). */
    @Post()
    @RequirePermissions(PERMISSIONS.sales.create)
    create(@Body() dto: CreateSalesOrderDto, @Req() req: Request) {
        const actor = actorFrom(req)
        if (dto.kind === SalesOrderKind.SINGLE || dto.kind === SalesOrderKind.LOT) {
            return this.workflow.createInternal(dto, actor)
        }
        return this.service.create(dto, actor.userId)
    }

    @Patch(':id')
    @RequirePermissions(PERMISSIONS.sales.update)
    update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto, @Req() req: Request) {
        return this.workflow.updateDraft(id, dto, actorFrom(req))
    }

    @Delete(':id')
    @RequirePermissions(PERMISSIONS.sales.delete)
    remove(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.deleteDraft(id, actorFrom(req))
    }

    @Get(':id/checks')
    @RequirePermissions(PERMISSIONS.sales.view)
    checks(@Param('id') id: string) {
        return this.workflow.previewChecks(id)
    }

    @Post(':id/submit')
    @RequirePermissions(PERMISSIONS.sales.submit)
    submit(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.submit(id, actorFrom(req))
    }

    /** Retry the hold for an order parked at AWAITING_STOCK/PARTIALLY_RESERVED. */
    @Post(':id/reserve')
    @RequirePermissions(PERMISSIONS.sales.submit, PERMISSIONS.sales.update)
    reserve(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.retryReserve(id, actorFrom(req))
    }

    @Post(':id/recall')
    @RequirePermissions(PERMISSIONS.sales.recall)
    recall(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.recall(id, actorFrom(req))
    }

    @Post(':id/cancel')
    @RequirePermissions(PERMISSIONS.sales.cancel)
    cancel(@Param('id') id: string, @Body() dto: CancelSalesOrderDto, @Req() req: Request) {
        return this.workflow.cancel(id, dto.reason, actorFrom(req))
    }

    // ===== Legacy DAY_TRADE endpoints (buy-to-order flow) =====

    @Post('from-purchase-order/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.sales.create)
    createFromPurchaseOrder(
        @Param('purchaseOrderId') purchaseOrderId: string,
        @Body() dto: CreateSalesOrderFromPurchaseDto,
    ) {
        return this.service.createFromPurchaseOrder(purchaseOrderId, dto)
    }

    @Post(':id/attach/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.sales.update)
    attachPurchaseOrder(
        @Param('id') id: string,
        @Param('purchaseOrderId') purchaseOrderId: string,
    ) {
        return this.service.attachPurchaseOrder(id, purchaseOrderId)
    }

    @Delete('link/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.sales.update)
    unlinkPurchaseOrder(@Param('purchaseOrderId') purchaseOrderId: string) {
        return this.service.unlinkPurchaseOrder(purchaseOrderId)
    }
}
