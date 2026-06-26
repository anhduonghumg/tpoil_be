import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { FetchVcbFxRateDto } from './dto/fetch-vcb-fx-rate.dto'
import { QueryVcbFxRatesDto } from './dto/query-vcb-fx-rates.dto'
import { UpsertVcbFxRateDto } from './dto/upsert-vcb-fx-rate.dto'
import { VcbFxRatesService } from './vcb-fx-rates.service'

@Controller('vcb-fx-rates')
export class VcbFxRatesController {
    constructor(private readonly service: VcbFxRatesService) {}

    @Get()
    list(@Query() query: QueryVcbFxRatesDto) {
        return this.service.list(query)
    }

    @Post('upsert')
    upsert(@Body() dto: UpsertVcbFxRateDto) {
        return this.service.upsert(dto)
    }

    @Post('fetch')
    fetchFromVcb(@Body() dto: FetchVcbFxRateDto) {
        return this.service.fetchFromVcb(dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.delete(id)
    }
}
