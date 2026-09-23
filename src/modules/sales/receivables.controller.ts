import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { ReceivablesService } from './receivables.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    AllocateReceivableDto,
    AllocateBankReceiptDto,
    AnnualCreditIndicatorsQueryDto,
    CarryForwardCollectionPlanDto,
    CreateCollectionPlanDto,
    CreateCustomerReceiptDto,
    CreditManagementQueryDto,
    ListReceivablesQueryDto,
    ListCollectionPlansQueryDto,
    ListCustomerReceiptsQueryDto,
    ReceivableAgingQueryDto,
    ReceivableCollectionKpiQueryDto,
    PartyDebtQueryDto,
    PostBankReceiptsFifoDto,
    ReverseReceiptDto,
} from './dto/receivable.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('receivables')
export class ReceivablesController {
    constructor(private readonly service: ReceivablesService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    list(@Query() query: ListReceivablesQueryDto) {
        return this.service.list(query)
    }

    /** Aging buckets per customer. */
    @Get('aging')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    aging(@Query() query: ReceivableAgingQueryDto) {
        return this.service.aging(query.customerPartyId, query.asOf)
    }

    /** Collection metrics are based on the bank value date, not import date. */
    @Get('collection-kpis')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    collectionKpis(@Query() query: ReceivableCollectionKpiQueryDto) {
        return this.service.collectionKpis(query.fromDate, query.toDate)
    }

    /** Daily collection plan and actual collection at customer level. */
    @Get('collection-plans')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    collectionPlans(@Query() query: ListCollectionPlansQueryDto) {
        return this.service.collectionPlans(query)
    }

    @Post('collection-plans')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    createCollectionPlan(@Body() dto: CreateCollectionPlanDto, @Req() req: Request) {
        return this.service.createCollectionPlan(dto, actorFrom(req))
    }

    @Post('collection-plans/:id/carry-forward')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    carryForwardCollectionPlan(
        @Param('id') id: string,
        @Body() dto: CarryForwardCollectionPlanDto,
        @Req() req: Request,
    ) {
        return this.service.carryForwardCollectionPlan(id, dto, actorFrom(req))
    }

    /** Customer-reported money is visible immediately but does not lower debt until confirmation. */
    @Get('customer-receipts')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    customerReceipts(@Query() query: ListCustomerReceiptsQueryDto) {
        return this.service.customerReceipts(query)
    }

    @Post('customer-receipts')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    createCustomerReceipt(@Body() dto: CreateCustomerReceiptDto, @Req() req: Request) {
        return this.service.createCustomerReceipt(dto, actorFrom(req))
    }

    @Post('customer-receipts/:id/confirm')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    confirmCustomerReceipt(@Param('id') id: string, @Req() req: Request) {
        return this.service.confirmCustomerReceipt(id, actorFrom(req))
    }

    @Post('customer-receipts/:id/reconcile/:bankTransactionId')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    reconcileCustomerReceipt(
        @Param('id') id: string,
        @Param('bankTransactionId', ParseUUIDPipe) bankTransactionId: string,
        @Req() req: Request,
    ) {
        return this.service.reconcileCustomerReceipt(id, bankTransactionId, actorFrom(req))
    }

    @Get('credit-management')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    creditManagement(@Query() query: CreditManagementQueryDto) {
        return this.service.creditManagement(query)
    }

    @Get('credit-indicators/annual')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    annualCreditIndicators(@Query() query: AnnualCreditIndicatorsQueryDto) {
        return this.service.annualCreditIndicators(query.year, query.customerPartyId, query.accountingOwnerEmpId)
    }

    /** Receivable and payable side by side for the same party. */
    @Get('party-debt')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    partyDebt(@Query() query: PartyDebtQueryDto) {
        return this.service.partyDebt(query)
    }

    @Get('customers/:customerPartyId/balance')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    customerBalance(@Param('customerPartyId') customerPartyId: string) {
        return this.service.customerBalance(customerPartyId)
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    /** Applies money received against an open item. */
    @Post('allocations')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    allocate(@Body() dto: AllocateReceivableDto, @Req() req: Request) {
        return this.service.allocate(dto, actorFrom(req))
    }

    /** Reconcile one inbound bank receipt against one or more customer debts. */
    @Post('bank-transactions/:bankTransactionId/allocate')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    allocateBankReceipt(
        @Param('bankTransactionId', ParseUUIDPipe) bankTransactionId: string,
        @Body() dto: AllocateBankReceiptDto,
        @Req() req: Request,
    ) {
        return this.service.allocateBankReceipt(bankTransactionId, dto, actorFrom(req))
    }

    /** Ghi nhận hàng loạt tiền về vào công nợ khách theo lũy kế (FIFO), không chọn đơn. */
    @Post('bank-transactions/post-fifo')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    postBankReceiptsFifo(@Body() dto: PostBankReceiptsFifoDto, @Req() req: Request) {
        return this.service.postBankReceiptsFifo(dto, actorFrom(req))
    }

    @Get('bank-transactions/:bankTransactionId/suggestions')
    @RequirePermissions(PERMISSIONS.sales.receivableView)
    receiptSuggestions(@Param('bankTransactionId', ParseUUIDPipe) bankTransactionId: string) {
        return this.service.receiptSuggestions(bankTransactionId)
    }

    /** Đảo một bút phân bổ; bút thuộc khoản thu FIFO thì đảo cả khoản thu. */
    @Post('allocations/:id/reverse')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    reverseAllocation(@Param('id') id: string, @Body() dto: ReverseReceiptDto, @Req() req: Request) {
        return this.service.reverseAllocation(id, actorFrom(req), dto ?? {})
    }

    @Post('customer-receipts/:id/reverse')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    reverseCustomerReceipt(@Param('id') id: string, @Body() dto: ReverseReceiptDto, @Req() req: Request) {
        return this.service.reverseCustomerReceipt(id, dto ?? {}, actorFrom(req))
    }

    /** Đảo ghi nhận của một dòng tiền vào (màn Thu tiền), trả dòng về hàng đợi để xử lý lại. */
    @Post('bank-transactions/:bankTransactionId/reverse')
    @RequirePermissions(PERMISSIONS.sales.receivableAllocate)
    reverseBankReceipt(@Param('bankTransactionId', ParseUUIDPipe) bankTransactionId: string, @Body() dto: ReverseReceiptDto, @Req() req: Request) {
        return this.service.reverseBankReceipt(bankTransactionId, dto ?? {}, actorFrom(req))
    }
}
