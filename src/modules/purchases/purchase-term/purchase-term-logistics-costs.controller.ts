import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { CreateTermLogisticsCostDto, UpdateTermLogisticsCostDto } from './dto/term-logistics-cost.dto'
import { PurchaseTermLogisticsCostsService } from './purchase-term-logistics-costs.service'

@Controller('purchase-terms')
export class PurchaseTermLogisticsCostsController {
    constructor(private readonly service: PurchaseTermLogisticsCostsService) {}

    @Get(':purchaseOrderId/logistics-costs')
    list(@Param('purchaseOrderId') purchaseOrderId: string) {
        return this.service.list(purchaseOrderId)
    }

    @Post(':purchaseOrderId/logistics-costs')
    create(@Param('purchaseOrderId') purchaseOrderId: string, @Body() dto: CreateTermLogisticsCostDto) {
        return this.service.create(purchaseOrderId, dto)
    }

    @Get(':purchaseOrderId/logistics-costs/:costId')
    detail(@Param('purchaseOrderId') purchaseOrderId: string, @Param('costId') costId: string) {
        return this.service.findById(purchaseOrderId, costId)
    }

    @Patch(':purchaseOrderId/logistics-costs/:costId')
    update(@Param('purchaseOrderId') purchaseOrderId: string, @Param('costId') costId: string, @Body() dto: UpdateTermLogisticsCostDto) {
        return this.service.update(purchaseOrderId, costId, dto)
    }

    @Delete(':purchaseOrderId/logistics-costs/:costId')
    remove(@Param('purchaseOrderId') purchaseOrderId: string, @Param('costId') costId: string) {
        return this.service.remove(purchaseOrderId, costId)
    }

    @Post(':purchaseOrderId/logistics-costs/:costId/confirm')
    confirm(@Param('purchaseOrderId') purchaseOrderId: string, @Param('costId') costId: string) {
        return this.service.confirm(purchaseOrderId, costId)
    }

    @Post(':purchaseOrderId/logistics-costs/:costId/void')
    void(@Param('purchaseOrderId') purchaseOrderId: string, @Param('costId') costId: string) {
        return this.service.void(purchaseOrderId, costId)
    }
}
