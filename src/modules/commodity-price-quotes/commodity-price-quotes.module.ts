import { Module } from '@nestjs/common'
import { CommodityPriceQuotesController } from './commodity-price-quotes.controller'
import { CommodityPriceQuotesService } from './commodity-price-quotes.service'

@Module({
    controllers: [CommodityPriceQuotesController],
    providers: [CommodityPriceQuotesService],
})
export class CommodityPriceQuotesModule {}
