import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesApprovalsService } from './sales-approvals.service'
import { SalesActor } from './sales-order-workflow.service'
import { DecideSalesApprovalDto, ListSalesApprovalsQueryDto } from './dto/sales-order.dto'

function actorFrom(req: Request): SalesActor {
    const auth = (req.session as any)?.auth
    return { userId: auth?.userId ?? (req as any).user?.id ?? null, permissions: auth?.permissions ?? [] }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-approvals')
export class SalesApprovalsController {
    constructor(private readonly service: SalesApprovalsService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.view)
    list(@Query() query: ListSalesApprovalsQueryDto, @Req() req: Request) {
        return this.service.list(query, actorFrom(req))
    }

    // Route guard chỉ cần "một trong các quyền duyệt"; quyền đúng theo LOẠI yêu cầu
    // được service kiểm tra lại (PermissionsGuard là ANY-of).
    @Post(':id/approve')
    @RequirePermissions(
        PERMISSIONS.sales.approvePrice,
        PERMISSIONS.sales.approveCredit,
        PERMISSIONS.sales.approveException,
    )
    approve(@Param('id') id: string, @Body() dto: DecideSalesApprovalDto, @Req() req: Request) {
        return this.service.decide(id, 'APPROVED', dto.note, actorFrom(req))
    }

    @Post(':id/reject')
    @RequirePermissions(
        PERMISSIONS.sales.approvePrice,
        PERMISSIONS.sales.approveCredit,
        PERMISSIONS.sales.approveException,
    )
    reject(@Param('id') id: string, @Body() dto: DecideSalesApprovalDto, @Req() req: Request) {
        return this.service.decide(id, 'REJECTED', dto.note, actorFrom(req))
    }
}
