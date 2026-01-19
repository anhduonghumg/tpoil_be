// src/modules/purchases/goods-receipts/goods-receipts.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { GoodsReceiptsService } from './goods-receipts.service'
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto'
import { ConfirmGoodsReceiptDto } from './dto/confirm-goods-receipt.dto'

@Controller('goods-receipts')
export class GoodsReceiptsController {
    constructor(private readonly service: GoodsReceiptsService) {}

    @Post()
    create(@Body() dto: CreateGoodsReceiptDto) {
        return this.service.create(dto)
    }

    @Post(':id/confirm')
    confirm(@Param('id') id: string, @Body() dto: ConfirmGoodsReceiptDto) {
        return this.service.confirm(id, dto)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return { id }
    }
}
