import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { CommercialLotsService } from './commercial-lots.service'
import {
    CreateCommercialLotWithdrawalDto,
    ListCommercialLotsQueryDto,
    ListLotWithdrawalsQueryDto,
} from './dto/commercial-lot.dto'

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('commercial-lot-purchases')
export class CommercialLotsController {
    constructor(private readonly service: CommercialLotsService) {}

    @Get()
    list(@Query() query: ListCommercialLotsQueryDto) {
        return this.service.list(query)
    }

    @Get('withdrawals')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    listWithdrawals(@Query() query: ListLotWithdrawalsQueryDto) {
        return this.service.listWithdrawals(query)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post(':id/withdrawals')
    createWithdrawal(
        @Param('id') id: string,
        @Body() dto: CreateCommercialLotWithdrawalDto,
        @Req() req: Request,
    ) {
        return this.service.createWithdrawal(id, dto, (req as any).user?.id)
    }

    @Post(':id/withdrawals/:withdrawalId/confirm')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    confirmWithdrawal(
        @Param('id') id: string,
        @Param('withdrawalId') withdrawalId: string,
        @Req() req: Request,
    ) {
        return this.service.confirmWithdrawal(id, withdrawalId, (req as any).user?.id)
    }

    @Post(':id/withdrawals/:withdrawalId/cancel')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    cancelWithdrawal(
        @Param('id') id: string,
        @Param('withdrawalId') withdrawalId: string,
        @Req() req: Request,
    ) {
        return this.service.cancelWithdrawal(id, withdrawalId, (req as any).user?.id)
    }
}
