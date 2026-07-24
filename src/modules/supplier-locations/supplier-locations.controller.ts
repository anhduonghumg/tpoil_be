import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { SupplierLocationsService } from './supplier-locations.service'
import { ListSupplierLocationsDto } from './dto/list-supplier-locations.dto'
import { CreateSupplierLocationDto } from './dto/create-supplier-location.dto'
import { UpdateSupplierLocationDto } from './dto/update-supplier-location.dto'
import { SupplierLocationsSelectQueryDto } from './dto/supplier-locations-select.dto'
import { CreateWarehouseAreaDto, UpdateWarehouseAreaDto } from './dto/warehouse-area.dto'

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

    @Get('areas')
    areas(@Query('isActive') isActive?: string) {
        return this.service.listAreas(isActive === undefined ? undefined : isActive === 'true')
    }

    @Post('areas')
    createArea(@Body() dto: CreateWarehouseAreaDto) {
        return this.service.createArea(dto)
    }

    @Patch('areas/:id')
    updateArea(@Param('id') id: string, @Body() dto: UpdateWarehouseAreaDto) {
        return this.service.updateArea(id, dto)
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
