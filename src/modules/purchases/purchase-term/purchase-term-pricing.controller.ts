import { Body, Controller, Param, Post } from '@nestjs/common'
import { CalculateTermPricingDto } from './dto/calculate-term-pricing.dto'
import { PurchaseTermPricingService } from './purchase-term-pricing.service'

@Controller('purchase-terms')
export class PurchaseTermPricingController {
    constructor(private readonly service: PurchaseTermPricingService) {}

    @Post(':orderId/pricing/estimate')
    createEstimate(@Param('orderId') orderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.createEstimate(orderId, dto)
    }

    @Post(':orderId/pricing/bill')
    createBillNormalize(@Param('orderId') orderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.createBillNormalize(orderId, dto)
    }

    @Post(':orderId/pricing/final')
    createFinal(@Param('orderId') orderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.createFinal(orderId, dto)
    }
}
