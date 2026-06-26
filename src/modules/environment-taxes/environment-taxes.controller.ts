import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CreateEnvironmentTaxDto } from './dto/create-environment-tax.dto'
import { QueryEnvironmentTaxesDto } from './dto/query-environment-taxes.dto'
import { UpdateEnvironmentTaxDto } from './dto/update-environment-tax.dto'
import { EnvironmentTaxesService } from './environment-taxes.service'

@Controller('environment-taxes')
export class EnvironmentTaxesController {
    constructor(private readonly service: EnvironmentTaxesService) {}

    @Get()
    list(@Query() query: QueryEnvironmentTaxesDto) {
        return this.service.list(query)
    }

    @Post()
    create(@Body() dto: CreateEnvironmentTaxDto) {
        return this.service.create(dto)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateEnvironmentTaxDto) {
        return this.service.update(id, dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.delete(id)
    }
}
