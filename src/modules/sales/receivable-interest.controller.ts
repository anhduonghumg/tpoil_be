import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { ReceivableInterestService } from './receivable-interest.service'
import { ReceivableInterestReportQueryDto, UpsertDepositInterestRateDto } from './dto/receivable-interest.dto'

/*
 * Prefix riêng, không lồng dưới "receivables": ReceivablesController có route GET ':id',
 * đặt "receivables/interest-report" thì request có thể rơi nhầm vào đó.
 */
@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('receivable-interest')
export class ReceivableInterestController {
    constructor(private readonly service: ReceivableInterestService) {}

    @Get('report')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    report(@Query() query: ReceivableInterestReportQueryDto) {
        return this.service.report(query)
    }

    @Get('rates')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    listRates() {
        return this.service.listRates()
    }

    @Post('rates')
    @RequirePermissions(PERMISSIONS.sales.creditManage)
    createRate(@Body() dto: UpsertDepositInterestRateDto, @Req() req: Request) {
        const auth = (req.session as any)?.auth
        return this.service.createRate(dto, auth?.userId ?? (req as any).user?.id ?? null)
    }

    @Put('rates/:id')
    @RequirePermissions(PERMISSIONS.sales.creditManage)
    updateRate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertDepositInterestRateDto) {
        return this.service.updateRate(id, dto)
    }

    @Delete('rates/:id')
    @RequirePermissions(PERMISSIONS.sales.creditManage)
    deleteRate(@Param('id', ParseUUIDPipe) id: string) {
        return this.service.deleteRate(id)
    }
}
