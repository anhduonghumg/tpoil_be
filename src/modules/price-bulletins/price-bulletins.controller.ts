// src/modules/price-bulletins/price-bulletins.controller.ts
import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ListPriceBulletinsDto, ListPriceItemsDto } from './dto/list-price-bulletins.dto'
import { PriceBulletinsService } from './price-bulletins.service'
import { CreatePriceBulletinDto } from './dto/create-price-bulletin.dto'
import { UpdatePriceBulletinDto } from './dto/update-price-bulletin.dto'
import { QuoteBatchDto, QuotePriceQueryDto, RegionsSelectQueryDto } from './dto/price-bulletins.dto'
import { CommitImportDto } from './dto/import-price-bulletin-pdf.dto'
// import { BackgroundJobsService } from '../background-jobs/background-jobs.service'
import { FileInterceptor } from '@nestjs/platform-express'
// import { JobArtifactsService } from '../job-artifacts/job-artifacts.service'
// import { PricePdfStorage } from './price-file.storage'

@Controller('price-bulletins')
export class PriceBulletinsController {
    constructor(
        private readonly service: PriceBulletinsService,
        // private readonly bg: BackgroundJobsService,
        // private readonly artifacts: JobArtifactsService,
        // private readonly storage: PricePdfStorage,
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

    @Post('quote-batch')
    quoteBatch(@Body() dto: QuoteBatchDto) {
        return this.service.quoteBatch({
            productIds: dto.productIds,
            regionCode: dto.regionCode,
            onDate: dto.onDate,
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
        return this.service.startImportPreview(file)
    }

    @Get('import-pdf/status/:runId')
    async getPreviewStatus(@Param('runId') runId: string) {
        return this.service.getImportStatus(runId)
    }

    // @Get('import-pdf/preview/:runId')
    // async getPreview(@Param('runId') runId: string) {
    //     const a = await this.artifacts.getArtifact(runId, ARTIFACT_PRICE_PDF_PREVIEW)
    //     if (!a) throw new BadRequestException('Chưa có preview cho phiên này')
    //     return { runId, artifact: a }
    // }

    @Get('import-pdf/preview/:runId')
    async getPreviewData(@Param('runId') runId: string) {
        return this.service.getPreviewData(runId)
    }

    @Patch('import-pdf/preview/:runId/line/:rowNo')
    async updatePreviewLine(
        @Param('runId') runId: string,
        @Param('rowNo', ParseIntPipe) rowNo: number,
        @Body() updateDto: { productId: string; regionId?: string; price?: number },
    ) {
        return this.service.updatePreviewLine(runId, rowNo, updateDto)
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
