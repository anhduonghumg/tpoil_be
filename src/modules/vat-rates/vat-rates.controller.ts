import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CreateVatRateDto } from './dto/create-vat-rate.dto'
import { UpdateVatRateDto } from './dto/update-vat-rate.dto'
import { VatRatesService } from './vat-rates.service'

@Controller('vat-rates')
export class VatRatesController {
    constructor(private readonly service: VatRatesService) {}

    @Get()
    list(@Query('isActive') isActive?: string) {
        return this.service.list(isActive)
    }

    @Get('select')
    select() {
        return this.service.select()
    }

    @Post()
    create(@Body() dto: CreateVatRateDto) {
        return this.service.create(dto)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateVatRateDto) {
        return this.service.update(id, dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.delete(id)
    }
}
