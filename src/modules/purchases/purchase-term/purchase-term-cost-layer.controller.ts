import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ConsumeTermCostLayerDto } from './dto/consume-term-cost-layer.dto'
import { PurchaseTermCostLayerService } from './purchase-term-cost-layer.service'

@Controller('purchase-term/cost-layers')
export class PurchaseTermCostLayerController {
    constructor(private readonly service: PurchaseTermCostLayerService) {}

    @Get('open')
    listOpen(@Query('supplierLocationId') supplierLocationId?: string, @Query('productId') productId?: string) {
        return this.service.listOpenLayers({ supplierLocationId, productId })
    }

    @Post('consume/preview')
    preview(@Body() dto: ConsumeTermCostLayerDto) {
        return this.service.previewConsume(dto)
    }

    @Post('consume/commit')
    commit(@Body() dto: ConsumeTermCostLayerDto) {
        return this.service.commitConsume(dto)
    }
}
