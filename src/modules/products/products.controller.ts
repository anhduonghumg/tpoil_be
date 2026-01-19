import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ProductsService } from './products.service'
import { ProductsSelectQueryDto } from './dto/products-select.dto'
import { ProductCreateDto } from './dto/product-create.dto'
import { ProductListQuery } from './dto/product-list.query'
import { ProductUpdateDto } from './dto/product-update.dto'

@Controller('products')
export class ProductsController {
    constructor(private readonly service: ProductsService) {}

    @Get()
    list(@Query() query: ProductListQuery) {
        return this.service.list(query)
    }
    @Get('select')
    select(@Query() q: ProductsSelectQueryDto) {
        return this.service.select(q)
    }

    @Get('all')
    all() {
        return this.service.all()
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: ProductCreateDto) {
        return this.service.create(dto)
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: ProductUpdateDto) {
        return this.service.update(id, dto)
    }
}
