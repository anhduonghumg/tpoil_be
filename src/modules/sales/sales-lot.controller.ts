import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesLotService } from './sales-lot.service'
import { SalesWithdrawalsService } from './sales-withdrawals.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    CancelWithdrawalDto,
    CreateLotAdjustmentDto,
    CreateWithdrawalDto,
    CustomerStockQueryDto,
    DecideLotAdjustmentDto,
    ListWithdrawalsQueryDto,
    SelectWithdrawalSourceDto,
    WithdrawalSourceQueryDto,
} from './dto/sales-lot.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-lot-orders')
export class SalesLotController {
    constructor(private readonly service: SalesLotService) {}

    /** Lot order with its four numbers per line: total / drawn / held / remaining. */
    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.view)
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post('adjustments')
    @RequirePermissions(PERMISSIONS.sales.update)
    requestAdjustment(@Body() dto: CreateLotAdjustmentDto, @Req() req: Request) {
        return this.service.requestAdjustment(dto, actorFrom(req))
    }

    @Post('adjustments/:id/approve')
    @RequirePermissions(PERMISSIONS.sales.approveException, PERMISSIONS.sales.approvePrice)
    approveAdjustment(
        @Param('id') id: string,
        @Body() dto: DecideLotAdjustmentDto,
        @Req() req: Request,
    ) {
        return this.service.decideAdjustment(id, 'APPROVED', dto, actorFrom(req))
    }

    @Post('adjustments/:id/reject')
    @RequirePermissions(PERMISSIONS.sales.approveException, PERMISSIONS.sales.approvePrice)
    rejectAdjustment(
        @Param('id') id: string,
        @Body() dto: DecideLotAdjustmentDto,
        @Req() req: Request,
    ) {
        return this.service.decideAdjustment(id, 'REJECTED', dto, actorFrom(req))
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-withdrawals')
export class SalesWithdrawalsController {
    constructor(private readonly service: SalesWithdrawalsService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.view)
    list(@Query() query: ListWithdrawalsQueryDto) {
        return this.service.list(query)
    }

    /** Lot orders that could serve this draw; sales must choose when several match. */
    @Get('source-candidates')
    @RequirePermissions(PERMISSIONS.sales.view)
    sourceCandidates(@Query() query: WithdrawalSourceQueryDto) {
        return this.service.sourceCandidates(query)
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.view)
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    @RequirePermissions(PERMISSIONS.sales.create)
    create(@Body() dto: CreateWithdrawalDto, @Req() req: Request) {
        return this.service.create(dto, actorFrom(req))
    }

    @Post(':id/select-source')
    @RequirePermissions(PERMISSIONS.sales.update)
    selectSource(
        @Param('id') id: string,
        @Body() dto: SelectWithdrawalSourceDto,
        @Req() req: Request,
    ) {
        return this.service.selectSource(id, dto, actorFrom(req))
    }

    @Post(':id/submit')
    @RequirePermissions(PERMISSIONS.sales.submit)
    submit(@Param('id') id: string, @Req() req: Request) {
        return this.service.submit(id, actorFrom(req))
    }

    @Post(':id/cancel')
    @RequirePermissions(PERMISSIONS.sales.cancel)
    cancel(@Param('id') id: string, @Body() dto: CancelWithdrawalDto, @Req() req: Request) {
        return this.service.cancel(id, dto, actorFrom(req))
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-customer-stock')
export class SalesCustomerStockController {
    constructor(private readonly service: SalesLotService) {}

    /** Commercial stock each customer still holds, per product. */
    @Get()
    @RequirePermissions(PERMISSIONS.sales.view)
    customerStock(@Query() query: CustomerStockQueryDto) {
        return this.service.customerStock(query)
    }
}
