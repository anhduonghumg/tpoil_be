import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common'
import type { Request } from 'express'
import { GoodsReceiptsService } from './goods-receipts.service'
import {
    CreateGoodsReceiptAutoConfirmDto,
    GoodsReceiptStockCardQueryDto,
    ListGoodsReceiptsQueryDto,
} from './dto/create-goods-receipt.dto'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { MODULE_CODES } from 'src/common/constants/modules'

@UseGuards(LoggedInGuard, PermissionsGuard)
// @UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.GOODS_RECEIPT)
@Controller('goods-receipts')
export class GoodsReceiptsController {
    constructor(private readonly service: GoodsReceiptsService) {}

    @Get()
    list(@Query() q: ListGoodsReceiptsQueryDto) {
        return this.service.list(q)
    }

    @Get('stock-card')
    stockCard(@Query() q: GoodsReceiptStockCardQueryDto) {
        return this.service.stockCard(q)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post('requests')
    createRequest(@Body() dto: CreateGoodsReceiptAutoConfirmDto, @Req() req: Request) {
        return this.service.createRequest(dto, (req as any).user?.id)
    }

    @Post(':id/confirm')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    confirm(@Param('id') id: string, @Req() req: Request) {
        return this.service.confirm(id, (req as any).user?.id)
    }

    @Post(':id/void')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    voidRequest(@Param('id') id: string, @Req() req: Request) {
        return this.service.voidRequest(id, (req as any).user?.id)
    }
}
