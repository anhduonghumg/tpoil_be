import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { CreateTermPaymentBatchDto, MatchTermPaymentBatchItemDto, QueryTermPaymentBatchesDto, UploadTermPaymentBatchFileDto } from './dto/term-payment-batch.dto'
import { TermPaymentBatchesService } from './term-payment-batches.service'

@Controller('banking/term-payment-batches')
export class TermPaymentBatchesController {
    constructor(private readonly service: TermPaymentBatchesService) {}

    @Get('pending-requests')
    pendingRequests() {
        return this.service.listPendingPaymentRequests()
    }

    @Get()
    list(@Query() query: QueryTermPaymentBatchesDto) {
        return this.service.listBatches(query)
    }

    @Post()
    create(@Body() dto: CreateTermPaymentBatchDto) {
        return this.service.createBatch(dto)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post(':id/send')
    send(@Param('id') id: string) {
        return this.service.markSent(id)
    }

    @Post(':id/files')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: {
                fileSize: 20 * 1024 * 1024,
            },
        }),
    )
    uploadFile(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadTermPaymentBatchFileDto) {
        return this.service.uploadFile(id, file, dto)
    }

    @Post(':id/items/:itemId/match')
    matchItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: MatchTermPaymentBatchItemDto) {
        return this.service.matchItem(id, itemId, dto)
    }
}
