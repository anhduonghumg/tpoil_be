import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { QueryCommodityPriceQuotesDto } from './dto/query-commodity-price-quotes.dto'
import { UpsertCommodityPriceQuoteDto } from './dto/upsert-commodity-price-quote.dto'
import { CommodityPriceQuotesService } from './commodity-price-quotes.service'

@Controller('commodity-price-quotes')
export class CommodityPriceQuotesController {
    constructor(private readonly service: CommodityPriceQuotesService) {}

    @Get()
    list(@Query() query: QueryCommodityPriceQuotesDto) {
        return this.service.list(query)
    }

    @Post('upsert')
    upsert(@Body() dto: UpsertCommodityPriceQuoteDto) {
        return this.service.upsert(dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.delete(id)
    }
}
