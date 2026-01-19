import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { SupplierLocationsService } from './supplier-locations.service'
import { ListSupplierLocationsDto } from './dto/list-supplier-locations.dto'
import { CreateSupplierLocationDto } from './dto/create-supplier-location.dto'
import { UpdateSupplierLocationDto } from './dto/update-supplier-location.dto'
import { SupplierLocationsSelectQueryDto } from './dto/supplier-locations-select.dto'

@Controller('supplier-locations')
export class SupplierLocationsController {
    constructor(private readonly service: SupplierLocationsService) {}

    @Get()
    list(@Query() dto: ListSupplierLocationsDto) {
        return this.service.list(dto)
    }

    @Get('select')
    select(@Query() q: SupplierLocationsSelectQueryDto) {
        return this.service.select(q)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreateSupplierLocationDto) {
        return this.service.create(dto)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateSupplierLocationDto) {
        return this.service.update(id, dto)
    }

    @Patch(':id/deactivate')
    deactivate(@Param('id') id: string) {
        return this.service.deactivate(id)
    }

    @Patch(':id/activate')
    activate(@Param('id') id: string) {
        return this.service.activate(id)
    }

    @Patch(':id/batch')
    batchUpdate(@Param('id') id: string, @Body() dto: UpdateSupplierLocationDto) {
        return this.service.batchUpdate(id, dto)
    }
}
