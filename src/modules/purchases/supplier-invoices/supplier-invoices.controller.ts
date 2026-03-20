import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { CreateSupplierInvoiceDto, PostSupplierInvoiceDto } from './dto/supplier-invoice.dto'
import { SupplierInvoiceImportPdfDto } from './dto/import-pdf.dto'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { SupplierInvoicesService } from './supplier-invoices.service'

@Controller('supplier-invoices')
export class SupplierInvoicesController {
    constructor(private readonly service: SupplierInvoicesService) {}

    @Get()
    detailByQuery(@Query('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreateSupplierInvoiceDto) {
        return this.service.create(dto)
    }

    @Post('import-pdf')
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
    importPdf(@UploadedFile() file: Express.Multer.File, @Body() dto: SupplierInvoiceImportPdfDto) {
        return this.service.importPdf({
            supplierCustomerId: dto.supplierCustomerId,
            purchaseOrderId: dto.purchaseOrderId,
            file,
        })
    }

    @Get('import-pdf/result/:runId')
    getImportPdfResult(@Param('runId') runId: string) {
        return this.service.getImportPdfResult(runId)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post(':id/post')
    post(@Param('id') id: string, @Body() dto: PostSupplierInvoiceDto) {
        return this.service.post(id, dto)
    }
}
