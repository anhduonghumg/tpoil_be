import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesDiscountService } from './sales-discount.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    CreateDiscountBoardDto,
    ListDiscountBoardsQueryDto,
    ResolveDiscountQueryDto,
    SendDiscountBoardDto,
    UpdateDiscountBoardDto,
} from './dto/sales-discount.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

/** Bảng thông báo chiết khấu — vận hành quản lý, kinh doanh chỉ đọc. */
@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-discounts')
export class SalesDiscountController {
    constructor(private readonly service: SalesDiscountService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.discountManage, PERMISSIONS.sales.view)
    list(@Query() query: ListDiscountBoardsQueryDto) {
        return this.service.list(query)
    }

    /** Bảng đang áp dụng ngay lúc này — dùng cho màn tạo đơn. */
    @Get('current')
    @RequirePermissions(PERMISSIONS.sales.discountManage, PERMISSIONS.sales.view)
    async current() {
        const board = await this.service.effectiveBoardAt()
        return board ? this.service.detail(board.id) : null
    }

    /** Tra chiết khấu của một kho × mặt hàng để form tự điền. */
    @Get('resolve')
    @RequirePermissions(PERMISSIONS.sales.discountManage, PERMISSIONS.sales.view)
    resolve(@Query() query: ResolveDiscountQueryDto) {
        return this.service.resolveOne(
            query.warehouseId,
            query.productId,
            query.at ? new Date(query.at) : new Date(),
        )
    }

    /** Khách đang hoạt động có email, để tick trước khi gửi. */
    @Get('recipient-candidates')
    @RequirePermissions(PERMISSIONS.sales.discountManage)
    recipientCandidates() {
        return this.service.recipientCandidates()
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.discountManage, PERMISSIONS.sales.view)
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    @RequirePermissions(PERMISSIONS.sales.discountManage)
    create(@Body() dto: CreateDiscountBoardDto, @Req() req: Request) {
        return this.service.create(dto, actorFrom(req))
    }

    @Patch(':id')
    @RequirePermissions(PERMISSIONS.sales.discountManage)
    update(@Param('id') id: string, @Body() dto: UpdateDiscountBoardDto) {
        return this.service.update(id, dto)
    }

    @Post(':id/publish')
    @RequirePermissions(PERMISSIONS.sales.discountManage)
    publish(@Param('id') id: string, @Req() req: Request) {
        return this.service.publish(id, actorFrom(req))
    }

    /** Thu hồi bản đã phát hành về nháp — chỉ khi chưa tới giờ hiệu lực. */
    @Post(':id/unpublish')
    @RequirePermissions(PERMISSIONS.sales.discountManage)
    unpublish(@Param('id') id: string) {
        return this.service.unpublish(id)
    }

    /** Đơn bán đã gửi duyệt trong lúc bản này đang hiệu lực. */
    @Get(':id/affected-orders')
    @RequirePermissions(PERMISSIONS.sales.discountManage, PERMISSIONS.sales.view)
    affectedOrders(@Param('id') id: string) {
        return this.service.affectedOrders(id)
    }

    @Post(':id/send')
    @RequirePermissions(PERMISSIONS.sales.discountManage)
    send(@Param('id') id: string, @Body() dto: SendDiscountBoardDto) {
        return this.service.send(id, dto)
    }

    @Delete(':id')
    @RequirePermissions(PERMISSIONS.sales.discountManage)
    cancel(@Param('id') id: string) {
        return this.service.cancel(id)
    }
}
