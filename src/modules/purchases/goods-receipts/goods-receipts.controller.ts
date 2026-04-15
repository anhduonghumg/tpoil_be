import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common'
import { GoodsReceiptsService } from './goods-receipts.service'
import { CreateGoodsReceiptAutoConfirmDto, ListGoodsReceiptsQueryDto } from './dto/create-goods-receipt.dto'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { MODULE_CODES } from 'src/common/constants/modules'

@UseGuards(LoggedInGuard)
// @UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.GOODS_RECEIPT)
@Controller('goods-receipts')
export class GoodsReceiptsController {
    constructor(private readonly service: GoodsReceiptsService) {}

    @Get()
    list(@Query() q: ListGoodsReceiptsQueryDto) {
        return this.service.list(q)
    }

    @Post('auto-confirm')
    createAutoConfirm(@Body() dto: CreateGoodsReceiptAutoConfirmDto) {
        return this.service.createAutoConfirm(dto)
    }
}
