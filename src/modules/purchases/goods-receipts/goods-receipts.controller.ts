import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { GoodsReceiptsService } from './goods-receipts.service'
import { CreateGoodsReceiptAutoConfirmDto, ListGoodsReceiptsQueryDto } from './dto/create-goods-receipt.dto'

@Controller('goods-receipts')
export class GoodsReceiptsController {
    constructor(private readonly service: GoodsReceiptsService) {}

    @Get()
    list(@Query() q: ListGoodsReceiptsQueryDto) {
        return this.service.list(q)
    }

    // @Post()
    // createAutoConfirm(@Body() dto: CreateGoodsReceiptAutoConfirmDto) {
    //     return this.service.createAutoConfirm(dto)
    // }

    @Post('auto-confirm')
    createAutoConfirm(@Body() dto: CreateGoodsReceiptAutoConfirmDto) {
        return this.service.createAutoConfirm(dto)
    }
}
