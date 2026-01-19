// src/modules/price-bulletins/price-bulletins.controller.ts
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ListPriceBulletinsDto, ListPriceItemsDto } from './dto/list-price-bulletins.dto'
import { PriceBulletinsService } from './price-bulletins.service'
import { CreatePriceBulletinDto } from './dto/create-price-bulletin.dto'
import { UpdatePriceBulletinDto } from './dto/update-price-bulletin.dto'
import { QuotePriceQueryDto, RegionsSelectQueryDto } from './dto/price-bulletins.dto'
import { CommitImportDto } from './dto/import-price-bulletin-pdf.dto'
import { BackgroundJobsService } from '../background-jobs/background-jobs.service'
import { FileInterceptor } from '@nestjs/platform-express'
import { BackgroundJobType } from '@prisma/client'
import { ARTIFACT_PRICE_PDF_INPUT, ARTIFACT_PRICE_PDF_PREVIEW, QB_PRICE_BULLETIN } from './jobs/price-bulletin-queues'
import { JobArtifactsService } from '../job-artifacts/job-artifacts.service'
import { PricePdfStorage } from './price-file.storage'
import { createHash } from 'crypto'

@Controller('price-bulletins')
export class PriceBulletinsController {
    constructor(
        private readonly service: PriceBulletinsService,
        private readonly bg: BackgroundJobsService,
        private readonly artifacts: JobArtifactsService,
        private readonly storage: PricePdfStorage,
    ) {}

    @Get()
    list(@Query() dto: ListPriceBulletinsDto) {
        return this.service.list(dto)
    }

    @Get('items')
    listPriceItems(@Query() dto: ListPriceItemsDto) {
        return this.service.listPriceItems(dto)
    }

    @Get('quote')
    quote(@Query() q: QuotePriceQueryDto) {
        return this.service.quotePrice({
            productId: q.productId,
            regionCode: q.regionCode,
            onDate: q.onDate,
        })
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreatePriceBulletinDto) {
        return this.service.create(dto)
    }

    @Post('import-pdf/preview')
    @UseInterceptors(FileInterceptor('file'))
    async startPreview(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('Vui lòng chọn file PDF')

        const checksum = createHash('sha256').update(file.buffer).digest('hex')

        const run = await this.bg.createRun({
            type: BackgroundJobType.PRICE_BULLETIN_IMPORT_PDF,
            name: `Bóc tách PDF: ${file.originalname}`,
            payload: { fileName: file.originalname, checksum, size: file.size },
        })

        await this.artifacts.upsertArtifact({
            runId: run.id,
            kind: ARTIFACT_PRICE_PDF_INPUT,
            checksum,
            content: {
                fileName: file.originalname,
                mime: file.mimetype,
                size: file.size,
                checksum,
                bufferBase64: file.buffer.toString('base64'),
            },
        })

        const jobId = `PRICE_BULLETIN_IMPORT_PDF:${checksum}`

        await this.bg.enqueueRun({
            type: BackgroundJobType.PRICE_BULLETIN_IMPORT_PDF,
            queueName: QB_PRICE_BULLETIN,
            runId: run.id,
            payloadRef: { checksum },
            jobId,
            profile: 'pdf_parse',
        })

        return { runId: run.id, checksum, message: 'Đang xử lý file PDF...' }
    }

    @Get('import-pdf/status/:runId')
    async getPreviewStatus(@Param('runId') runId: string) {
        return this.service.getImportStatus(runId)
    }

    @Get('import-pdf/preview/:runId')
    async getPreview(@Param('runId') runId: string) {
        const a = await this.artifacts.getArtifact(runId, ARTIFACT_PRICE_PDF_PREVIEW)
        if (!a) throw new BadRequestException('Chưa có preview cho phiên này')
        return { runId, artifact: a }
    }

    @Post('import-pdf/commit')
    async commitImport(@Body() dto: CommitImportDto) {
        const result = await this.service.importPdfCommit(dto)
        return { message: 'Cập nhật bảng giá thành công', data: result }
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdatePriceBulletinDto) {
        return this.service.update(id, dto)
    }

    @Post(':id/publish')
    publish(@Param('id') id: string) {
        return this.service.publish(id)
    }

    @Post(':id/void')
    void(@Param('id') id: string) {
        return this.service.void(id)
    }

    @Get('regions/select')
    regionsSelect(@Query() q: RegionsSelectQueryDto) {
        return this.service.regionsSelect(q.keyword)
    }
}
