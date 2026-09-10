// src/modules/price-bulletins/price-bulletins.controller.ts
import { BadRequestException, Body, Controller, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import type { Response } from 'express'
import { ListPriceBulletinsDto, ListPriceItemsDto } from './dto/list-price-bulletins.dto'
import { PriceBulletinsService } from './price-bulletins.service'
import { PriceBulletinPrintService } from './price-bulletin-print.service'
import { CreatePriceBulletinDto } from './dto/create-price-bulletin.dto'
import { UpdatePriceBulletinDto } from './dto/update-price-bulletin.dto'
import { QuoteBatchDto, QuotePriceQueryDto, RegionsSelectQueryDto } from './dto/price-bulletins.dto'
import { CommitImportDto } from './dto/import-price-bulletin-pdf.dto'
import { FileInterceptor } from '@nestjs/platform-express'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { MODULE_CODES } from 'src/common/constants/modules'

@UseGuards(LoggedInGuard)
// @UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.PRICE_BULLETIN)
@Controller('price-bulletins')
export class PriceBulletinsController {
    constructor(
        private readonly service: PriceBulletinsService,
        private readonly print: PriceBulletinPrintService,
    ) {}

    /**
     * Ảnh thông báo giá để gửi khách và đại lý. Đặt TRƯỚC route ':id' vì Nest khớp theo
     * thứ tự khai báo — để sau thì ':id' nuốt mất đường này.
     */
    @Get(':id/notice.png')
    @Header('Content-Type', 'image/png')
    async noticePng(@Param('id') id: string, @Res() res: Response) {
        const { buffer, data } = await this.print.renderNoticePng(id)
        res.setHeader(
            'Content-Disposition',
            `inline; filename="${this.print.fileStem(data, 'thong-bao-gia')}.png"`,
        )
        res.end(buffer)
    }

    /** Quyết định điều chỉnh giá, bản A4 để in ra ký và đóng dấu. */
    @Get(':id/decision.pdf')
    @Header('Content-Type', 'application/pdf')
    async decisionPdf(@Param('id') id: string, @Res() res: Response) {
        const { buffer, data } = await this.print.renderDecisionPdf(id)
        res.setHeader(
            'Content-Disposition',
            `inline; filename="${this.print.fileStem(data, 'quyet-dinh-gia')}.pdf"`,
        )
        res.end(buffer)
    }

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

    /** Mặt hàng được phép lên bảng giá, đúng thứ tự mẫu văn bản. */
    @Get('products/select')
    productsSelect() {
        return this.service.productsForPriceDoc()
    }

    @Get('regions/select')
    regionsSelect(@Query() q: RegionsSelectQueryDto) {
        return this.service.regionsSelect(q.keyword)
    }
}
