import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesApprovalsService } from './sales-approvals.service'
import { SalesActor } from './sales-order-workflow.service'
import {
    AdjustLineDiscountDto,
    AdjustLineSupplierDto,
    DecideManySalesApprovalsDto,
    DecideSalesApprovalDto,
    ListSalesApprovalsQueryDto,
} from './dto/sales-order.dto'

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
    /** Duyệt hàng loạt — mỗi yêu cầu độc lập, cái nào lỗi báo riêng cái đó. */
    @Post('approve-many')
    @RequirePermissions(
        PERMISSIONS.sales.approvePrice,
        PERMISSIONS.sales.approveCredit,
        PERMISSIONS.sales.approveException,
    )
    approveMany(@Body() dto: DecideManySalesApprovalsDto, @Req() req: Request) {
        return this.service.decideMany(dto.ids, 'APPROVED', dto.note, actorFrom(req))
    }

    @Post('reject-many')
    @RequirePermissions(
        PERMISSIONS.sales.approvePrice,
        PERMISSIONS.sales.approveCredit,
        PERMISSIONS.sales.approveException,
    )
    rejectMany(@Body() dto: DecideManySalesApprovalsDto, @Req() req: Request) {
        return this.service.decideMany(dto.ids, 'REJECTED', dto.note, actorFrom(req))
    }

    /** Sửa CK điều chỉnh ngay trên hàng đợi; thành tiền đơn tính lại theo CK mới. */
    @Patch('lines/:lineId/discount')
    @RequirePermissions(
        PERMISSIONS.sales.approvePrice,
        PERMISSIONS.sales.approveCredit,
        PERMISSIONS.sales.approveException,
    )
    adjustLineDiscount(
        @Param('lineId') lineId: string,
        @Body() dto: AdjustLineDiscountDto,
        @Req() req: Request,
    ) {
        return this.service.adjustLineDiscount(lineId, dto.discountAdjustmentAmount, actorFrom(req))
    }

    /** Quản lý chọn Mã NCC ngay trên hàng đợi duyệt; bỏ chọn để quay về AUTO FIFO. */
    @Patch('lines/:lineId/supplier')
    @RequirePermissions(
        PERMISSIONS.sales.approveOrder,
        PERMISSIONS.sales.approvePrice,
        PERMISSIONS.sales.approveCredit,
        PERMISSIONS.sales.approveException,
    )
    adjustLineSupplier(
        @Param('lineId') lineId: string,
        @Body() dto: AdjustLineSupplierDto,
        @Req() req: Request,
    ) {
        return this.service.adjustLineSupplier(lineId, dto.supplierPartyId, actorFrom(req))
    }

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

    @Post(':id/return-to-pending')
    @RequirePermissions(
        PERMISSIONS.sales.approveOrder,
        PERMISSIONS.sales.approvePrice,
        PERMISSIONS.sales.approveCredit,
        PERMISSIONS.sales.approveException,
    )
    returnToPending(@Param('id') id: string, @Req() req: Request) {
        return this.service.returnToPending(id, actorFrom(req))
    }
}
