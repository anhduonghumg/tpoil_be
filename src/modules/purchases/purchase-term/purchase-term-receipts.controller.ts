import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { CreateTermGoodsReceiptDto } from './dto/create-term-goods-receipt.dto'
import { UpdateTermGoodsReceiptDto } from './dto/update-term-goods-receipt.dto'
import { PurchaseTermReceiptsService } from './purchase-term-receipts.service'

@Controller('purchase-terms')
export class PurchaseTermReceiptsController {
    constructor(private readonly service: PurchaseTermReceiptsService) {}

    @Get(':orderId/receipts')
    listByOrder(@Param('orderId') orderId: string) {
        return this.service.listByOrder(orderId)
    }

    @Post(':orderId/receipts')
    create(@Param('orderId') orderId: string, @Body() dto: CreateTermGoodsReceiptDto) {
        return this.service.create(orderId, dto)
    }

    @Get('receipts/:id')
    detail(@Param('id') id: string) {
        return this.service.findById(id)
    }

    @Patch('receipts/:id')
    update(@Param('id') id: string, @Body() dto: UpdateTermGoodsReceiptDto) {
        return this.service.update(id, dto)
    }

    @Post('receipts/:id/confirm')
    confirm(@Param('id') id: string) {
        return this.service.confirm(id)
    }

    @Post('receipts/:id/void')
    void(@Param('id') id: string) {
        return this.service.void(id)
    }
}
