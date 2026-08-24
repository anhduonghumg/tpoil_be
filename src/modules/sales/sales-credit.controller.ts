import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesCreditService } from './sales-credit.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import { ListCreditCustomersQueryDto, UpdateCustomerCreditDto } from './dto/sales-credit.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

/** Cấu hình hạn mức tín dụng — màn hình của kế toán công nợ. */
@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-credit')
export class SalesCreditController {
    constructor(private readonly service: SalesCreditService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.creditManage, PERMISSIONS.sales.receivableView)
    list(@Query() query: ListCreditCustomersQueryDto) {
        return this.service.list(query)
    }

    @Get(':customerPartyId')
    @RequirePermissions(PERMISSIONS.sales.creditManage, PERMISSIONS.sales.receivableView)
    detail(@Param('customerPartyId') customerPartyId: string) {
        return this.service.detail(customerPartyId)
    }

    /**
     * Sửa hạn mức; bắt buộc có lý do và luôn ghi lịch sử.
     *
     * Ai duyệt được tín dụng cho đơn thì cũng đặt được hạn mức — cùng một người, cùng
     * một trách nhiệm, không bắt họ chờ cấp thêm quyền mới.
     */
    @Patch(':customerPartyId')
    @RequirePermissions(PERMISSIONS.sales.creditManage, PERMISSIONS.sales.approveCredit)
    update(
        @Param('customerPartyId') customerPartyId: string,
        @Body() dto: UpdateCustomerCreditDto,
        @Req() req: Request,
    ) {
        return this.service.update(customerPartyId, dto, actorFrom(req))
    }
}
