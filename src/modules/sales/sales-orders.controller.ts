import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { SalesOrdersService } from './sales-orders.service'
import {
    CreateSalesOrderDto,
    CreateSalesOrderFromPurchaseDto,
    ListSalesOrdersQueryDto,
} from './dto/sales-order.dto'

@UseGuards(LoggedInGuard)
@Controller('sales-orders')
export class SalesOrdersController {
    constructor(private readonly service: SalesOrdersService) {}

    @Get()
    list(@Query() query: ListSalesOrdersQueryDto) {
        return this.service.list(query)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreateSalesOrderDto, @Req() req: Request) {
        return this.service.create(dto, (req as any).user?.id)
    }

    @Post('from-purchase-order/:purchaseOrderId')
    createFromPurchaseOrder(
        @Param('purchaseOrderId') purchaseOrderId: string,
        @Body() dto: CreateSalesOrderFromPurchaseDto,
    ) {
        return this.service.createFromPurchaseOrder(purchaseOrderId, dto)
    }

    @Delete('link/:purchaseOrderId')
    unlinkPurchaseOrder(@Param('purchaseOrderId') purchaseOrderId: string) {
        return this.service.unlinkPurchaseOrder(purchaseOrderId)
    }
}
