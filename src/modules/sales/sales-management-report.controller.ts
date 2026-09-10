import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesManagementReportQueryDto } from './dto/sales-management-report.dto'
import { SalesManagementReportService } from './sales-management-report.service'

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-management-report')
export class SalesManagementReportController {
    constructor(private readonly service: SalesManagementReportService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.profitabilityView)
    get(@Query() query: SalesManagementReportQueryDto) {
        return this.service.get(query)
    }
}
