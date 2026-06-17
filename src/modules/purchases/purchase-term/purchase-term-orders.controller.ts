import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CreateTermPurchaseOrderDto } from './dto/create-term-purchase-order.dto'
import { ListTermPurchaseOrdersQueryDto } from './dto/list-term-purchase-orders.query.dto'
// import { UpdateTermPurchaseOrderDto } from './dto/update-term-purchase-order.dto'
import { PurchaseTermOrdersService } from './purchase-term-orders.service'
import { VcbFxService } from './vcb-fx.service'

@Controller('purchase-terms')
export class PurchaseTermOrdersController {
    constructor(
        private readonly service: PurchaseTermOrdersService,
        private readonly vcbFxService: VcbFxService,
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
    getVcbFx() {
        return this.vcbFxService.getUsdSellRate()
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.findById(id)
    }

    @Post(':id/approve')
    approve(@Param('id') id: string) {
        return this.service.approve(id)
    }

    // @Patch(':id')
    // update(@Param('id') id: string, @Body() dto: UpdateTermPurchaseOrderDto) {
    //     return this.service.update(id, dto)
    // }

    // @Post(':id/approve')
    // approve(@Param('id') id: string) {
    //     return this.service.approve(id)
    // }

    // @Post(':id/cancel')
    // cancel(@Param('id') id: string) {
    //     return this.service.cancel(id)
    // }

    // @Get(':id/next-action')
    // getNextAction(@Param('id') id: string) {
    //     return this.service.getNextAction(id)
    // }

    // @Post(':id/complete')
    // complete(@Param('id') id: string) {
    //     return this.service.complete(id)
    // }
}
