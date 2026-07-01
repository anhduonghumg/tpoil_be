import { Module } from '@nestjs/common'

import { PurchaseTermCostLayerController } from './purchase-term-cost-layer.controller'
import { PurchaseTermCostLayerService } from './purchase-term-cost-layer.service'
import { PurchaseTermLogisticsCostsController } from './purchase-term-logistics-costs.controller'
import { PurchaseTermLogisticsCostsService } from './purchase-term-logistics-costs.service'
import { PurchaseTermFlowDocumentsController } from './purchase-term-flow-documents.controller'
import { PurchaseTermFlowDocumentsService } from './purchase-term-flow-documents.service'
import { PurchaseTermNextActionService } from './purchase-term-next-action.service'
import { PurchaseTermOrdersController } from './purchase-term-orders.controller'
import { PurchaseTermOrdersService } from './purchase-term-orders.service'
import { PurchaseTermOrderDocumentsController } from './purchase-term-order-documents.controller'
import { PurchaseTermOrderDocumentsService } from './purchase-term-order-documents.service'
import { PurchaseTermPricingController } from './purchase-term-pricing.controller'
import { PurchaseTermPricingService } from './purchase-term-pricing.service'
import { PurchaseTermReceiptsController } from './purchase-term-receipts.controller'
import { PurchaseTermReceiptsService } from './purchase-term-receipts.service'
import { PurchaseTermShipmentsController } from './purchase-term-shipments.controller'
import { PurchaseTermShipmentsService } from './purchase-term-shipments.service'
import { VcbFxService } from './vcb-fx.service'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { VcbFxRatesModule } from 'src/modules/vcb-fx-rates/vcb-fx-rates.module'
import { EnvironmentTaxesModule } from 'src/modules/environment-taxes/environment-taxes.module'

@Module({
    imports: [PrismaModule, VcbFxRatesModule, EnvironmentTaxesModule],
    controllers: [
        PurchaseTermOrdersController,
        PurchaseTermOrderDocumentsController,
        PurchaseTermFlowDocumentsController,
        PurchaseTermReceiptsController,
        PurchaseTermPricingController,
        PurchaseTermCostLayerController,
        PurchaseTermShipmentsController,
        PurchaseTermLogisticsCostsController,
    ],
    providers: [
        PurchaseTermOrdersService,
        PurchaseTermOrderDocumentsService,
        PurchaseTermFlowDocumentsService,
        PurchaseTermReceiptsService,
        PurchaseTermPricingService,
        PurchaseTermCostLayerService,
        PurchaseTermNextActionService,
        PurchaseTermShipmentsService,
        PurchaseTermLogisticsCostsService,
        VcbFxService,
    ],
    exports: [
        PurchaseTermOrdersService,
        PurchaseTermOrderDocumentsService,
        PurchaseTermFlowDocumentsService,
        PurchaseTermReceiptsService,
        PurchaseTermPricingService,
        PurchaseTermCostLayerService,
        PurchaseTermNextActionService,
        PurchaseTermShipmentsService,
        PurchaseTermLogisticsCostsService,
    ],
})
export class PurchaseTermModule {}
