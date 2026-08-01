// src/modules/purchases/purchase-orders/purchase-orders.controller.ts
import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common'
import type { Request, Response } from 'express'
import path from 'path'
import { PurchaseOrdersService } from './purchase-orders.service'
import { ApprovePurchaseOrderDto, BulkPurchaseOrderIdsDto, CreatePurchaseOrderDto, ListPurchaseOrdersQueryDto } from './dto/purchase-order.dto'
import { JobArtifactsService } from 'src/modules/job-artifacts/job-artifacts.service'
import { ARTIFACT_PO_PRINT_OUTPUT } from './jobs/purchase-order-print-queues'
import { CreatePurchaseOrderPrintBatchDto } from './dto/create-purchase-order-print-batch.dto'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { MODULE_CODES } from 'src/common/constants/modules'
import { ModuleName } from 'src/common/decorators/module-name.decorator'

@UseGuards(LoggedInGuard)
// @UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.PURCHASE_ORDER)
@Controller('purchase-orders')
export class PurchaseOrdersController {
    constructor(
        private readonly service: PurchaseOrdersService,
        private readonly jobArtifactsService: JobArtifactsService,
    ) {}

    @Get()
    list(@Query() q: ListPurchaseOrdersQueryDto) {
        return this.service.list(q)
    }

    @Get('tab-counts')
    getTabCounts(@Query() query: ListPurchaseOrdersQueryDto) {
        return this.service.getTabCounts(query)
    }

    @Get('validate-contract')
    validateContract(@Query('supplierCustomerId') supplierCustomerId: string, @Query('orderDate') orderDate: string) {
        return this.service.validateContract(supplierCustomerId, orderDate)
    }

    @Get('payment-requests/:requestId/print')
    async printPaymentRequest(@Param('requestId') requestId: string, @Res() res: Response) {
        const pdfBuffer = await this.service.printPaymentRequestByRequestId(requestId)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="payment-request-${requestId}.pdf"`)
        return res.send(pdfBuffer)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreatePurchaseOrderDto, @Req() req: Request) {
        return this.service.create(dto, (req as any).user?.id)
    }

    @Patch(':id')
    updateDraft(@Param('id') id: string, @Body() dto: CreatePurchaseOrderDto) {
        return this.service.updateDraft(id, dto)
    }

    @Patch(':id/actual-received')
    updateActualReceived(
        @Param('id') id: string,
        @Body() body: { lines: Array<{ purchaseOrderLineId: string; actualReceivedQty: number }> },
    ) {
        return this.service.updateActualReceived(id, body?.lines ?? [])
    }

    @Post(':id/approve')
    approve(@Param('id') id: string, @Body() _dto: ApprovePurchaseOrderDto, @Req() req: Request) {
        return this.service.approve(id, (req as any).user?.id)
    }

    @Post(':id/cancel')
    cancel(@Param('id') id: string, @Req() req: Request) {
        return this.service.cancel(id, (req as any).user?.id)
    }

    @Get(':id/print')
    async printSingle(@Param('id') id: string, @Res() res: Response) {
        const pdfBuffer = await this.service.generateSinglePrintPdf(id)

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="PO-${id}.pdf"`)

        return res.send(pdfBuffer)
    }

    @Post('approve-many')
    approveMany(@Body() body: BulkPurchaseOrderIdsDto) {
        return this.service.approveMany(body.ids)
    }

    @Post('cancel-many')
    cancelMany(@Body() body: BulkPurchaseOrderIdsDto) {
        return this.service.cancelMany(body.ids)
    }

    // @Post('print-batch-sync')
    // async printBatchSync(@Body() dto: CreatePurchaseOrderPrintBatchDto, @Res() res: Response) {
    //     const pdfBuffer = await this.service.printBatchSync(dto)

    //     res.setHeader('Content-Type', 'application/pdf')
    //     res.setHeader('Content-Disposition', 'inline; filename="purchase-orders.pdf"')

    //     return res.send(pdfBuffer)
    // }

    @Post('print-payment-request-batch-sync')
    async printPaymentRequestBatchSync(@Body() dto: CreatePurchaseOrderPrintBatchDto, @Res() res: Response) {
        const pdfBuffer = await this.service.printPaymentRequestBatchSync(dto)

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', 'inline; filename="payment-requests.pdf"')

        return res.send(pdfBuffer)
    }

    @Post('print-batch')
    printBatch(@Body() dto: CreatePurchaseOrderPrintBatchDto) {
        return this.service.createPrintBatch(dto)
    }

    @Get('print-batch/:runId')
    getPrintStatus(@Param('runId') runId: string) {
        return this.service.getPrintStatus(runId)
    }

    @Get('print-batch/:runId/download')
    async downloadPrintBatch(@Param('runId') runId: string, @Res() res: Response) {
        const output = await this.jobArtifactsService.getArtifact(runId, ARTIFACT_PO_PRINT_OUTPUT)

        if (!output?.fileUrl || !(output.content as any)?.fileName) {
            throw new NotFoundException('FILE_NOT_READY')
        }

        const fileName = (output.content as any).fileName as string
        const filePath = path.join(process.cwd(), 'public', 'po', fileName)

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
        return res.sendFile(filePath)
    }
}
