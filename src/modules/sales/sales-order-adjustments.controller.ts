import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesOrderAdjustmentsService } from './sales-order-adjustments.service'
import {
    CreateSalesOrderAdjustmentDto,
    DecideSalesOrderAdjustmentDto,
} from './dto/sales-order-adjustment.dto'
import { SalesActor } from './sales-order-workflow.service'

function actorFrom(req: Request): SalesActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-order-adjustments')
export class SalesOrderAdjustmentsController {
    constructor(private readonly service: SalesOrderAdjustmentsService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.view)
    list(@Query('salesOrderId') salesOrderId?: string) {
        return this.service.list(salesOrderId)
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.view)
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    @RequirePermissions(PERMISSIONS.sales.update)
    create(@Body() dto: CreateSalesOrderAdjustmentDto, @Req() req: Request) {
        return this.service.create(dto, actorFrom(req))
    }

    @Post(':id/approve')
    @RequirePermissions(PERMISSIONS.sales.approveOrder)
    approve(
        @Param('id') id: string,
        @Body() dto: DecideSalesOrderAdjustmentDto,
        @Req() req: Request,
    ) {
        return this.service.approve(id, dto, actorFrom(req))
    }

    @Post(':id/reject')
    @RequirePermissions(PERMISSIONS.sales.approveOrder)
    reject(
        @Param('id') id: string,
        @Body() dto: DecideSalesOrderAdjustmentDto,
        @Req() req: Request,
    ) {
        return this.service.reject(id, dto, actorFrom(req))
    }
}
