import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { CreateSupplierInvoiceDto, PostSupplierInvoiceDto, VoidSupplierInvoiceDto } from './dto/supplier-invoice.dto'
import { SupplierInvoiceImportPdfDto } from './dto/import-pdf.dto'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { SupplierInvoicesService } from './supplier-invoices.service'

@Controller('supplier-invoices')
export class SupplierInvoicesController {
    constructor(private readonly service: SupplierInvoicesService) {}

    @Post()
    create(@Body() dto: CreateSupplierInvoiceDto) {
        return this.service.create(dto)
    }

    @Post('import-pdf/preview')
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
    previewPdf(@UploadedFile() file: Express.Multer.File, @Body() dto: SupplierInvoiceImportPdfDto) {
        return this.service.previewPdfImport({
            supplierCustomerId: dto.supplierCustomerId,
            file,
        })
    }

    @Get('import-pdf/preview/:runId')
    getPreview(@Param('runId') runId: string) {
        return this.service.getPreviewResult(runId)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post(':id/post')
    post(@Param('id') id: string, @Body() dto: PostSupplierInvoiceDto) {
        return this.service.post(id, dto)
    }

    // @Post(':id/void')
    // void(@Param('id') id: string, @Body() dto: VoidSupplierInvoiceDto) {
    //     return this.service.void(id, dto)
    // }
}
