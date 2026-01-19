// src/modules/settlements/supplier-settlements/supplier-settlements.controller.ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { SupplierSettlementsService } from './supplier-settlements.service'
import { AllocateSettlementDto, CreateSupplierSettlementDto, ListSupplierSettlementsQueryDto } from './supplier-settlements/dto/supplier-settlement.dto'

@Controller('supplier-settlements')
export class SupplierSettlementsController {
    constructor(private readonly service: SupplierSettlementsService) {}

    @Get()
    list(@Query() q: ListSupplierSettlementsQueryDto) {
        return this.service.list(q)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreateSupplierSettlementDto) {
        return this.service.create(dto)
    }

    @Post(':id/allocate')
    allocate(@Param('id') id: string, @Body() dto: AllocateSettlementDto) {
        return this.service.allocate(id, dto)
    }

    @Post(':id/void')
    void(@Param('id') id: string) {
        return this.service.void(id)
    }
}
