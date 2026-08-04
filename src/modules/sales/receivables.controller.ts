import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { ReceivablesService } from './receivables.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    AllocateReceivableDto,
    ListReceivablesQueryDto,
    PartyDebtQueryDto,
} from './dto/receivable.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('receivables')
export class ReceivablesController {
    constructor(private readonly service: ReceivablesService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    list(@Query() query: ListReceivablesQueryDto) {
        return this.service.list(query)
    }

    /** Aging buckets per customer. */
    @Get('aging')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    aging(@Query('customerPartyId') customerPartyId?: string) {
        return this.service.aging(customerPartyId)
    }

    /** Receivable and payable side by side for the same party. */
    @Get('party-debt')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    partyDebt(@Query() query: PartyDebtQueryDto) {
        return this.service.partyDebt(query)
    }

    @Get('customers/:customerPartyId/balance')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    customerBalance(@Param('customerPartyId') customerPartyId: string) {
        return this.service.customerBalance(customerPartyId)
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    /** Applies money received against an open item. */
    @Post('allocations')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    allocate(@Body() dto: AllocateReceivableDto, @Req() req: Request) {
        return this.service.allocate(dto, actorFrom(req))
    }

    @Post('allocations/:id/reverse')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    reverseAllocation(@Param('id') id: string, @Req() req: Request) {
        return this.service.reverseAllocation(id, actorFrom(req))
    }
}
