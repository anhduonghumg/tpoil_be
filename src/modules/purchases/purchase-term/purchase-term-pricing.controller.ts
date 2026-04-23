import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { CalculateTermPricingDto } from './dto/calculate-term-pricing.dto'
import { PurchaseTermPricingService } from './purchase-term-pricing.service'

@Controller('purchase-term')
export class PurchaseTermPricingController {
    constructor(private readonly service: PurchaseTermPricingService) {}

    @Post('orders/:id/pricing/calculate')
    calculate(@Param('id') purchaseOrderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.calculate(purchaseOrderId, dto)
    }

    @Get('orders/:id/pricing-runs')
    listByOrder(@Param('id') purchaseOrderId: string) {
        return this.service.listByOrder(purchaseOrderId)
    }

    @Get('pricing-runs/:id')
    detail(@Param('id') id: string) {
        return this.service.findRunById(id)
    }

    @Post('pricing-runs/:id/post')
    postRun(@Param('id') id: string) {
        return this.service.postRun(id)
    }
}
