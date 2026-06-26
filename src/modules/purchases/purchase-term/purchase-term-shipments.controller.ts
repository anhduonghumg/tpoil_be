import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { CreateTermShipmentDto, UpdateTermShipmentDto } from './dto/term-shipment.dto'
import { PurchaseTermShipmentsService } from './purchase-term-shipments.service'

@Controller('purchase-terms')
export class PurchaseTermShipmentsController {
    constructor(private readonly service: PurchaseTermShipmentsService) {}

    @Get(':purchaseOrderId/shipments')
    list(@Param('purchaseOrderId') purchaseOrderId: string) {
        return this.service.list(purchaseOrderId)
    }

    @Post(':purchaseOrderId/shipments')
    create(@Param('purchaseOrderId') purchaseOrderId: string, @Body() dto: CreateTermShipmentDto) {
        return this.service.create(purchaseOrderId, dto)
    }

    @Patch(':purchaseOrderId/shipments/:shipmentId')
    update(@Param('purchaseOrderId') purchaseOrderId: string, @Param('shipmentId') shipmentId: string, @Body() dto: UpdateTermShipmentDto) {
        return this.service.update(purchaseOrderId, shipmentId, dto)
    }

    @Delete(':purchaseOrderId/shipments/:shipmentId')
    remove(@Param('purchaseOrderId') purchaseOrderId: string, @Param('shipmentId') shipmentId: string) {
        return this.service.remove(purchaseOrderId, shipmentId)
    }
}
