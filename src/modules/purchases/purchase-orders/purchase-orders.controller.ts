// src/modules/purchases/purchase-orders/purchase-orders.controller.ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { PurchaseOrdersService } from './purchase-orders.service'
import { ApprovePurchaseOrderDto, CreatePurchaseOrderDto, ListPurchaseOrdersQueryDto } from './dto/purchase-order.dto'

@Controller('purchase-orders')
export class PurchaseOrdersController {
    constructor(private readonly service: PurchaseOrdersService) {}

    @Get()
    list(@Query() q: ListPurchaseOrdersQueryDto) {
        return this.service.list(q)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreatePurchaseOrderDto) {
        return this.service.create(dto)
    }

    @Post(':id/approve')
    approve(@Param('id') id: string, @Body() _dto: ApprovePurchaseOrderDto) {
        return this.service.approve(id)
    }

    @Post(':id/cancel')
    cancel(@Param('id') id: string) {
        return this.service.cancel(id)
    }
}
