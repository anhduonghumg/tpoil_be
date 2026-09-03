import { Controller, Get, UseGuards } from '@nestjs/common'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesDashboardService } from './sales-dashboard.service'

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-dashboard')
export class SalesDashboardController {
    constructor(private readonly service: SalesDashboardService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.view)
    get() {
        return this.service.get()
    }
}
