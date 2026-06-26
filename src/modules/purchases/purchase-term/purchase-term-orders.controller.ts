import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CreateTermPurchaseOrderDto } from './dto/create-term-purchase-order.dto'
import { ListTermPurchaseOrdersQueryDto } from './dto/list-term-purchase-orders.query.dto'
import { UpdateTermPurchaseOrderDto } from './dto/update-term-purchase-order.dto'
import { PurchaseTermOrdersService } from './purchase-term-orders.service'
import { VcbFxService } from './vcb-fx.service'
import { VcbFxRatesService } from 'src/modules/vcb-fx-rates/vcb-fx-rates.service'
import { EnvironmentTaxesService } from 'src/modules/environment-taxes/environment-taxes.service'

@Controller('purchase-terms')
export class PurchaseTermOrdersController {
    constructor(
        private readonly service: PurchaseTermOrdersService,
        private readonly vcbFxService: VcbFxService,
        private readonly vcbFxRatesService: VcbFxRatesService,
        private readonly environmentTaxesService: EnvironmentTaxesService,
    ) {}

    @Post()
    create(@Body() dto: CreateTermPurchaseOrderDto) {
        return this.service.create(dto)
    }

    @Get()
    list(@Query() query: ListTermPurchaseOrdersQueryDto) {
        return this.service.list(query)
    }

    @Get('platts-average')
    getPlattsAverage(
        @Query('productId')
        productId: string,

        @Query('baseDate')
        baseDate: string,
    ) {
        return this.service.getPlattsAverage(productId, baseDate)
    }

    @Get('vcb-fx-rate')
    async getVcbFx(
        @Query('date')
        date?: string,

        @Query('currencyCode')
        currencyCode?: string,
    ) {
        if (date) {
            return this.vcbFxRatesService.findForDate({
                date,
                bankCode: 'VCB',
                currencyCode,
            })
        }

        return this.vcbFxService.getUsdSellRate()
    }

    @Get('environment-tax')
    getEnvironmentTax(
        @Query('productId')
        productId: string,

        @Query('date')
        date: string,
    ) {
        return this.environmentTaxesService.lookup({ productId, date })
    }

    @Get('validate-contract')
    validateContract(
        @Query('supplierCustomerId')
        supplierCustomerId: string,

        @Query('orderDate')
        orderDate?: string,
    ) {
        return this.service.validateContract(supplierCustomerId, orderDate)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.findById(id)
    }

    @Post(':id/approve')
    approve(@Param('id') id: string) {
        return this.service.approve(id)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateTermPurchaseOrderDto) {
        return this.service.update(id, dto)
    }

    @Post(':id/cancel')
    cancel(@Param('id') id: string) {
        return this.service.cancel(id)
    }

    @Get(':id/next-action')
    getNextAction(@Param('id') id: string) {
        return this.service.getNextAction(id)
    }

    @Post(':id/complete')
    complete(@Param('id') id: string) {
        return this.service.complete(id)
    }
}
