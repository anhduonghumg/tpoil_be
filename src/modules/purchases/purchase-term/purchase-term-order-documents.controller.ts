import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { PrintTermOrderDocumentsDto } from './dto/print-term-order-documents.dto'
import { PurchaseTermOrderDocumentsService } from './purchase-term-order-documents.service'

@Controller('purchase-terms')
export class PurchaseTermOrderDocumentsController {
    constructor(private readonly service: PurchaseTermOrderDocumentsService) {}

    @Post(':orderId/order-document/generate')
    generate(@Param('orderId') orderId: string) {
        return this.service.generate(orderId)
    }

    @Get(':orderId/order-document')
    detail(@Param('orderId') orderId: string) {
        return this.service.detail(orderId)
    }

    @Post('order-documents/print')
    printBatch(@Body() dto: PrintTermOrderDocumentsDto) {
        return this.service.printBatch(dto)
    }
}
