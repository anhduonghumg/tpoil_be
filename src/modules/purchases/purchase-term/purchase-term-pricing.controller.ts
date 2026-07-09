import { BadRequestException, Body, Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { CalculateTermPricingDto } from './dto/calculate-term-pricing.dto'
import { PurchaseTermPricingService } from './purchase-term-pricing.service'

@Controller('purchase-terms')
export class PurchaseTermPricingController {
    constructor(private readonly service: PurchaseTermPricingService) {}

    @Post('pricing/import-preview')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 8 * 1024 * 1024 },
        }),
    )
    importPricingSheetPreview(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('Vui lòng chọn file bảng giá')
        }

        return this.service.importPricingSheetPreview(file)
    }

    @Post(':orderId/pricing/estimate')
    createEstimate(@Param('orderId') orderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.createEstimate(orderId, dto)
    }

    @Post(':orderId/pricing/bill')
    createBillNormalize(@Param('orderId') orderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.createBillNormalize(orderId, dto)
    }

    @Post(':orderId/pricing/final')
    createFinal(@Param('orderId') orderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.createFinal(orderId, dto)
    }

    @Post(':orderId/pricing/boss-sheet')
    createBossSheetPricing(@Param('orderId') orderId: string, @Body() dto: CalculateTermPricingDto) {
        return this.service.createBossSheet(orderId, dto)
    }
}
