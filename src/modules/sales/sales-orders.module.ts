import { Module } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { SalesIssuePostingService } from 'src/modules/inventory/sales-issue-posting.service'
import { PurchaseTermCostLayerService } from 'src/modules/purchases/purchase-term/purchase-term-cost-layer.service'
import { SalesOrdersController } from './sales-orders.controller'
import { SalesOrdersService } from './sales-orders.service'
import { SalesApprovalsController } from './sales-approvals.controller'
import { SalesApprovalsService } from './sales-approvals.service'
import { SalesDeliveriesController } from './sales-deliveries.controller'
import { SalesDeliveriesService } from './sales-deliveries.service'
import { SalesReconciliationController } from './sales-reconciliation.controller'
import { SalesReconciliationService } from './sales-reconciliation.service'
import {
    SalesCustomerStockController,
    SalesLotController,
    SalesWithdrawalsController,
} from './sales-lot.controller'
import { SalesLotService } from './sales-lot.service'
import { SalesWithdrawalsService } from './sales-withdrawals.service'
import { ReceivablesController } from './receivables.controller'
import { ReceivablesService } from './receivables.service'
import { SalesCreditController } from './sales-credit.controller'
import { SalesCreditService } from './sales-credit.service'
import { SalesOrderPrintService } from './sales-order-print.service'
import { SalesDiscountController } from './sales-discount.controller'
import { SalesDiscountService } from './sales-discount.service'
import { MailService } from 'src/mail/mail.service'
import { PartyMerchantService } from 'src/modules/customers/party-merchant.service'
import { SalesInvoicesController } from './sales-invoices.controller'
import { SalesInvoicesService } from './sales-invoices.service'
import { SalesProfitabilityController } from './sales-profitability.controller'
import { SalesAliasController } from './sales-alias.controller'
import { SalesAliasService } from './sales-alias.service'
import { SalesQuickEntryController } from './quick-entry/sales-quick-entry.controller'
import { SalesQuickEntryService } from './quick-entry/sales-quick-entry.service'
import { DeepSeekClientService } from 'src/infra/deepseek/deepseek-client.service'
import { SalesProfitabilityService } from './sales-profitability.service'
import { MisaClientService } from 'src/infra/misa/misa-client.service'
import { SalesOrderChecksService } from './sales-order-checks.service'
import { SalesOrderStatusService } from './sales-order-status.service'
import { SalesOrderWorkflowService } from './sales-order-workflow.service'
import { SalesReservationService } from './sales-reservation.service'
import { SalesWarehouseScopeService } from './sales-warehouse-scope.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'

@Module({
    controllers: [
        SalesOrdersController,
        SalesApprovalsController,
        SalesDeliveriesController,
        SalesReconciliationController,
        SalesLotController,
        SalesWithdrawalsController,
        SalesCustomerStockController,
        SalesInvoicesController,
        SalesProfitabilityController,
        SalesAliasController,
        SalesQuickEntryController,
        ReceivablesController,
        SalesCreditController,
        SalesDiscountController,
    ],
    providers: [
        PrismaService,
        InventoryCoreService,
        PurchaseTermCostLayerService,
        SalesIssuePostingService,
        SalesOrdersService,
        SalesOrderPrintService,
        SalesOrderChecksService,
        SalesOrderStatusService,
        SalesOrderWorkflowService,
        SalesWorkflowEventsService,
        SalesReservationService,
        SalesDeliveriesService,
        SalesReconciliationService,
        SalesLotService,
        SalesWithdrawalsService,
        ReceivablesService,
        SalesCreditService,
        SalesDiscountService,
        PartyMerchantService,
        MailService,
        MisaClientService,
        SalesInvoicesService,
        SalesProfitabilityService,
        SalesAliasService,
        DeepSeekClientService,
        SalesQuickEntryService,
        SalesWarehouseScopeService,
        SalesApprovalsService,
    ],
    exports: [
        SalesOrdersService,
        SalesOrderWorkflowService,
        SalesDeliveriesService,
        SalesLotService,
        SalesWithdrawalsService,
        ReceivablesService,
        SalesInvoicesService,
        SalesProfitabilityService,
        SalesAliasService,
        SalesQuickEntryService,
    ],
})
export class SalesOrdersModule {}
