// src/modules/purchases/supplier-invoices/supplier-invoices.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { SupplierInvoicesService } from './supplier-invoices.service'
import { CreateSupplierInvoiceDto, PostSupplierInvoiceDto, VoidSupplierInvoiceDto } from './dto/supplier-invoice.dto'

@Controller('supplier-invoices')
export class SupplierInvoicesController {
    constructor(private readonly service: SupplierInvoicesService) {}

    @Post()
    create(@Body() dto: CreateSupplierInvoiceDto) {
        return this.service.create(dto as any)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post(':id/post')
    post(@Param('id') id: string, @Body() dto: PostSupplierInvoiceDto) {
        return this.service.post(id, dto)
    }

    @Post(':id/void')
    void(@Param('id') id: string, @Body() dto: VoidSupplierInvoiceDto) {
        return this.service.void(id, dto)
    }
}
