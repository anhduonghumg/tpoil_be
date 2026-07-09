import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { CreateTermGoodsReceiptDto } from './dto/create-term-goods-receipt.dto'
import { UpdateTermGoodsReceiptDto } from './dto/update-term-goods-receipt.dto'
import { PurchaseTermReceiptsService } from './purchase-term-receipts.service'

@Controller('purchase-terms')
export class PurchaseTermReceiptsController {
    constructor(private readonly service: PurchaseTermReceiptsService) {}

    @Get(':orderId/receipts')
    listByOrder(@Param('orderId') orderId: string) {
        return this.service.listByOrder(orderId)
    }

    @Post(':orderId/receipts/import-preview')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 8 * 1024 * 1024 },
        }),
    )
    importReceiptDocumentPreview(@UploadedFile() file: Express.Multer.File, @Body('template') template: string) {
        if (!file) throw new BadRequestException('TERM_RECEIPT_DOCUMENT_FILE_REQUIRED')
        return this.service.importReceiptDocumentPreview(file, template)
    }

    @Post(':orderId/receipts')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 8 * 1024 * 1024 },
        }),
    )
    create(@Param('orderId') orderId: string, @Body() dto: CreateTermGoodsReceiptDto, @UploadedFile() file?: Express.Multer.File) {
        return this.service.create(orderId, dto, file)
    }

    @Get('receipts/:id')
    detail(@Param('id') id: string) {
        return this.service.findById(id)
    }

    @Patch('receipts/:id')
    update(@Param('id') id: string, @Body() dto: UpdateTermGoodsReceiptDto) {
        return this.service.update(id, dto)
    }

    @Post('receipts/:id/confirm')
    confirm(@Param('id') id: string) {
        return this.service.confirm(id)
    }

    @Post('receipts/:id/void')
    void(@Param('id') id: string) {
        return this.service.void(id)
    }
}
