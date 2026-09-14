import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { SalesOrderKind } from '@prisma/client'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesOrdersService } from './sales-orders.service'
import { SalesOrderWorkflowService, SalesActor } from './sales-order-workflow.service'
import { SalesOrderPrintService } from './sales-order-print.service'
import {
    CancelSalesOrderDto,
    CreateSalesOrderDto,
    CreateSalesOrderFromPurchaseDto,
    CreditPreviewQueryDto,
    ListSalesOrdersQueryDto,
    PrintSalesOrdersDto,
    UpdateSalesOrderDto,
} from './dto/sales-order.dto'

function actorFrom(req: Request): SalesActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-orders')
export class SalesOrdersController {
    constructor(
        private readonly service: SalesOrdersService,
        private readonly workflow: SalesOrderWorkflowService,
        private readonly print$: SalesOrderPrintService,
    ) {}

    @Get()
    list(@Query() query: ListSalesOrdersQueryDto) {
        return this.service.list(query)
    }

    @Get('status-counts')
    statusCounts(@Query() query: ListSalesOrdersQueryDto) {
        return this.service.statusCounts(query)
    }

    /**
     * Công nợ của khách nếu lưu đơn này — màn nhập đơn gọi trước khi lưu để cảnh báo.
     *
     * Quyền theo sales.create/update chứ không theo quyền xem công nợ: người nhập đơn cần
     * thấy con số này để biết đơn sẽ phải qua kế toán công nợ, nhưng không vì thế mà được
     * mở màn quản lý hạn mức.
     *
     * Phải khai TRƯỚC @Get(':id'), không thì "credit-preview" bị nhận là id.
     */
    @Get('credit-preview')
    @RequirePermissions(PERMISSIONS.sales.create, PERMISSIONS.sales.update)
    creditPreview(@Query() query: CreditPreviewQueryDto) {
        return this.service.creditPreview({
            customerPartyId: query.customerPartyId,
            orderValue: Number(query.orderValue ?? 0),
            excludeOrderId: query.excludeOrderId,
        })
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    /** Single create endpoint dispatching by kind (spec v1.2 §14). */
    @Post()
    @RequirePermissions(PERMISSIONS.sales.create)
    create(@Body() dto: CreateSalesOrderDto, @Req() req: Request) {
        const actor = actorFrom(req)
        if (
            !dto.kind ||
            dto.kind === SalesOrderKind.SINGLE ||
            dto.kind === SalesOrderKind.LOT ||
            dto.kind === SalesOrderKind.DAY_TRADE
        ) {
            return this.workflow.createInternal(
                { ...dto, kind: dto.kind ?? SalesOrderKind.DAY_TRADE },
                actor,
            )
        }
        return this.service.create(dto, actor.userId)
    }

    @Patch(':id')
    @RequirePermissions(PERMISSIONS.sales.update)
    update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto, @Req() req: Request) {
        return this.workflow.updateDraft(id, dto, actorFrom(req))
    }

    @Delete(':id')
    @RequirePermissions(PERMISSIONS.sales.delete)
    remove(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.deleteDraft(id, actorFrom(req))
    }

    @Get(':id/checks')
    @RequirePermissions(PERMISSIONS.sales.view)
    checks(@Param('id') id: string) {
        return this.workflow.previewChecks(id)
    }

    /**
     * In nhiều đơn thành một file. Đặt trước `:id/print` không quan trọng vì khác method,
     * nhưng để cạnh nhau cho dễ đọc.
     */
    @Post('print-batch')
    @RequirePermissions(PERMISSIONS.sales.view)
    async printBatch(@Body() dto: PrintSalesOrdersDto, @Res() res: Response) {
        const { buffer, count } = await this.print$.renderBatchPdf(dto)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="don-dat-hang-${count}.pdf"`)
        res.end(buffer)
    }

    /** Đơn đặt hàng để gửi khách ký: mẫu chọn theo loại đơn và cách xuất hóa đơn. */
    @Get(':id/print')
    @RequirePermissions(PERMISSIONS.sales.view)
    async print(@Param('id') id: string, @Res() res: Response) {
        const { buffer, orderNo } = await this.print$.renderPdf(id)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${orderNo}.pdf"`)
        res.end(buffer)
    }

    @Post(':id/submit')
    @RequirePermissions(PERMISSIONS.sales.submit)
    submit(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.submit(id, actorFrom(req))
    }

    /** Retry the hold for an order parked at AWAITING_STOCK/PARTIALLY_RESERVED. */
    @Post(':id/reserve')
    @RequirePermissions(PERMISSIONS.sales.submit, PERMISSIONS.sales.update)
    reserve(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.retryReserve(id, actorFrom(req))
    }

    @Post(':id/recall')
    @RequirePermissions(PERMISSIONS.sales.recall)
    recall(@Param('id') id: string, @Req() req: Request) {
        return this.workflow.recall(id, actorFrom(req))
    }

    @Post(':id/cancel')
    @RequirePermissions(PERMISSIONS.sales.cancel)
    cancel(@Param('id') id: string, @Body() dto: CancelSalesOrderDto, @Req() req: Request) {
        return this.workflow.cancel(id, dto.reason, actorFrom(req))
    }

    // ===== Legacy DAY_TRADE endpoints (buy-to-order flow) =====

    @Post('from-purchase-order/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.sales.create)
    createFromPurchaseOrder(
        @Param('purchaseOrderId') _purchaseOrderId: string,
        @Body() _dto: CreateSalesOrderFromPurchaseDto,
    ) {
        // Kept only to return a clear error to older frontend builds. DAY_TRADE now
        // always starts from an approved sales order, then purchasing creates linked POs.
        throw new BadRequestException({
            code: 'DAY_TRADE_SALES_FIRST_REQUIRED',
            message: 'Đơn đối ứng phải tạo và duyệt đơn bán trước, sau đó tạo đơn mua từ danh sách chờ mua.',
        })
    }

    @Post(':id/attach/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.sales.update)
    attachPurchaseOrder(
        @Param('id') id: string,
        @Param('purchaseOrderId') purchaseOrderId: string,
    ) {
        return this.service.attachPurchaseOrder(id, purchaseOrderId)
    }

    @Delete('link/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.sales.update)
    unlinkPurchaseOrder(@Param('purchaseOrderId') purchaseOrderId: string) {
        return this.service.unlinkPurchaseOrder(purchaseOrderId)
    }
}
