import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesDeliveriesService } from './sales-deliveries.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    ConfirmSalesDeliveryDto,
    ListSalesDeliveriesQueryDto,
    ReturnSalesDeliveryDto,
    VoidSalesDeliveryDto,
} from './dto/sales-delivery.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-deliveries')
export class SalesDeliveriesController {
    constructor(private readonly service: SalesDeliveriesService) {}

    /** Warehouse work queue; results are limited to the warehouses the user covers. */
    @Get()
    @RequirePermissions(PERMISSIONS.sales.view, PERMISSIONS.sales.deliveryConfirm)
    list(@Query() query: ListSalesDeliveriesQueryDto, @Req() req: Request) {
        return this.service.list(query, actorFrom(req))
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.view, PERMISSIONS.sales.deliveryConfirm)
    detail(@Param('id') id: string, @Req() req: Request) {
        return this.service.detail(id, actorFrom(req))
    }

    /** FIFO proposal the warehouse may override before confirming. */
    @Get(':id/fifo-suggestion')
    @RequirePermissions(PERMISSIONS.sales.deliveryConfirm)
    fifoSuggestion(@Param('id') id: string, @Req() req: Request) {
        return this.service.fifoSuggestion(id, actorFrom(req))
    }

    @Post(':id/confirm')
    @RequirePermissions(PERMISSIONS.sales.deliveryConfirm)
    confirm(@Param('id') id: string, @Body() dto: ConfirmSalesDeliveryDto, @Req() req: Request) {
        return this.service.confirm(id, dto, actorFrom(req))
    }

    @Post(':id/void')
    @RequirePermissions(PERMISSIONS.sales.deliveryVoid)
    voidPosted(@Param('id') id: string, @Body() dto: VoidSalesDeliveryDto, @Req() req: Request) {
        return this.service.voidPosted(id, dto, actorFrom(req))
    }

    @Post(':id/return')
    @RequirePermissions(PERMISSIONS.sales.deliveryReturn, PERMISSIONS.sales.deliveryConfirm)
    returnToSales(
        @Param('id') id: string,
        @Body() dto: ReturnSalesDeliveryDto,
        @Req() req: Request,
    ) {
        return this.service.returnToSales(id, dto, actorFrom(req))
    }

    @Post(':id/resend')
    @RequirePermissions(PERMISSIONS.sales.update)
    resend(@Param('id') id: string, @Req() req: Request) {
        return this.service.resend(id, actorFrom(req))
    }
}
