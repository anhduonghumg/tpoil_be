import { Module } from '@nestjs/common'

import { PurchaseTermCostLayerController } from './purchase-term-cost-layer.controller'
import { PurchaseTermCostLayerService } from './purchase-term-cost-layer.service'
import { PurchaseTermNextActionService } from './purchase-term-next-action.service'
import { PurchaseTermOrdersController } from './purchase-term-orders.controller'
import { PurchaseTermOrdersService } from './purchase-term-orders.service'
import { PurchaseTermPricingController } from './purchase-term-pricing.controller'
import { PurchaseTermPricingService } from './purchase-term-pricing.service'
import { PurchaseTermReceiptsController } from './purchase-term-receipts.controller'
import { PurchaseTermReceiptsService } from './purchase-term-receipts.service'
import { PrismaModule } from 'src/infra/prisma/prisma.module'

@Module({
    imports: [PrismaModule],
    controllers: [PurchaseTermOrdersController, PurchaseTermReceiptsController, PurchaseTermPricingController, PurchaseTermCostLayerController],
    providers: [PurchaseTermOrdersService, PurchaseTermReceiptsService, PurchaseTermPricingService, PurchaseTermCostLayerService, PurchaseTermNextActionService],
    exports: [PurchaseTermOrdersService, PurchaseTermReceiptsService, PurchaseTermPricingService, PurchaseTermCostLayerService, PurchaseTermNextActionService],
})
export class PurchaseTermModule {}
