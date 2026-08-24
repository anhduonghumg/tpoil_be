import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
    PaymentTermType,
    Prisma,
    SalesDeliveryStatus,
    SalesInvoiceDocumentType,
    SalesInvoiceStatus,
    SalesLotInvoiceMode,
    SalesOrderKind,
    SalesOrderStatus,
    SalesWithdrawalStatus,
    SalesReconciliationStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { MisaClientService, isRetryableMisaError } from 'src/infra/misa/misa-client.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { ReceivablesService } from './receivables.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import { SalesOrderChecksService } from './sales-order-checks.service'
import {
    CancelSalesInvoiceDto,
    InvoiceSourceDto,
    ListSalesInvoicesQueryDto,
    ListUnissuedSalesInvoicesQueryDto,
} from './dto/sales-invoice.dto'

/**
 * Đơn lô xuất hóa đơn cả lô được lập từ lúc đơn đã duyệt cho tới khi rút xong — trong
 * suốt quãng đó đơn đi qua nhiều trạng thái giao hàng, hóa đơn vẫn là một.
 */
const invoiceableLotStatuses: SalesOrderStatus[] = [
    SalesOrderStatus.CONFIRMED,
    SalesOrderStatus.AWAITING_STOCK,
    SalesOrderStatus.PARTIALLY_RESERVED,
    SalesOrderStatus.RESERVED,
    SalesOrderStatus.WAREHOUSE_PROCESSING,
    SalesOrderStatus.PARTIALLY_DELIVERED,
    SalesOrderStatus.DELIVERED,
    SalesOrderStatus.AWAITING_RECONCILIATION,
    SalesOrderStatus.AWAITING_INVOICE,
]

const detailInclude = Prisma.validator<Prisma.SalesInvoiceInclude>()({
    customer: { select: { id: true, code: true, name: true, taxCode: true } },
    accountantEmployee: { select: { id: true, code: true, fullName: true } },
    salesOrder: { select: { id: true, orderNo: true, orderDate: true, kind: true } },
    withdrawalRequest: { select: { id: true, requestNo: true, requestDate: true } },
    lines: {
        orderBy: { lineNo: 'asc' },
        include: { product: { select: { id: true, code: true, name: true, uom: true } } },
    },
    issuances: { orderBy: { startedAt: 'desc' }, take: 20 },
    receivableItem: { select: { id: true, outstandingAmount: true, status: true, dueDate: true } },
    corrections: { select: { id: true, invoiceNoInternal: true, documentType: true, status: true } },
})

type InvoiceDraftLine = {
    salesOrderLineId: string
    salesDeliveryLineId: string | null
    productId: string
    description: string
    uom: string
    qty: Prisma.Decimal
    unitPrice: Prisma.Decimal
    discountAmount: Prisma.Decimal
    taxRate: Prisma.Decimal | null
    netAmount: Prisma.Decimal
    taxAmount: Prisma.Decimal
    lineTotal: Prisma.Decimal
}

/**
 * Output invoices through MISA meInvoice (spec v1.2 §10).
 *
 * Duplicate protection has three layers: a partial unique index (one live ORIGINAL per
 * commercial document), a unique MISA transaction id, and a query-first retry that asks MISA
 * whether the key already produced an invoice before publishing again.
 */
@Injectable()
export class SalesInvoicesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly misa: MisaClientService,
        private readonly events: SalesWorkflowEventsService,
        private readonly receivables: ReceivablesService,
        private readonly notificationOutbox: NotificationOutboxService,
        private readonly checks: SalesOrderChecksService,
    ) {}

    private async nextInvoiceNo(tx: Prisma.TransactionClient, date: Date) {
        const year = String(date.getUTCFullYear()).slice(-2)
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        const period = `${year}${month}`
        const sequence = await tx.documentSequence.upsert({
            where: { moduleCode_period: { moduleCode: 'SALES_INVOICE', period } },
            create: { moduleCode: 'SALES_INVOICE', period, currentNo: 1 },
            update: { currentNo: { increment: 1 } },
        })
        return `HD${period}${String(sequence.currentNo).padStart(5, '0')}`
    }

    /** Tổng dự kiến để kế toán thấy ngay ở danh sách chưa xuất HĐ. Hóa đơn nháp vẫn được
     * dựng lại từ dữ liệu thực xuất trước khi lưu, nên đây không thay thế bước kiểm tra đó. */
    private summarizeUnissuedLines(
        lines: Array<{
            qty: Prisma.Decimal
            unitPrice: Prisma.Decimal
            discountAmount: Prisma.Decimal
            taxRate: Prisma.Decimal | null
            productCode: string | null
        }>,
    ) {
        const total = lines.reduce((sum, line) => {
            const net = line.qty.mul(line.unitPrice).minus(line.qty.mul(line.discountAmount))
            return sum.plus(net.plus(line.taxRate ? net.mul(line.taxRate) : 0))
        }, new Prisma.Decimal(0))
        return {
            itemCodes: [...new Set(lines.map((line) => line.productCode).filter((code): code is string => !!code))],
            estimatedGrandTotal: total.toString(),
        }
    }

    /**
     * Builds the invoice content from what actually left the warehouse — never from what was
     * ordered — and refuses if the document is not ready to be billed.
     */
    /**
     * Hóa đơn cho cả lô, lập ngay sau khi đơn được duyệt (mẫu "ĐƠN ĐẶT HÀNG LÔ" với
     * thời gian xuất hóa đơn = ngay sau khi xác nhận đơn hàng).
     *
     * Không có lệnh xuất nào để dựa vào, cũng không có gì để đối soát — hàng chưa rời
     * kho. Vì thế dòng hóa đơn lấy thẳng từ dòng đơn và không gắn salesDeliveryLineId.
     */
    private async buildWholeLotDraft(
        db: Prisma.TransactionClient | PrismaService,
        salesOrderId: string,
    ) {
        const order = await db.salesOrder.findUniqueOrThrow({
            where: { id: salesOrderId },
            include: {
                customer: {
                    select: {
                        id: true,
                        name: true,
                        taxCode: true,
                        billingAddress: true,
                        contactEmail: true,
                        accountingOwnerEmpId: true,
                    },
                },
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: { product: { select: { id: true, name: true, uom: true } } },
                },
            },
        })

        // Chỉ lập được sau khi đơn đã qua kiểm duyệt: hóa đơn ra trước hàng, nên giá và
        // hạn mức phải được chốt trước đó.
        if (!invoiceableLotStatuses.includes(order.status)) {
            throw new BadRequestException({
                code: 'INVOICE_LOT_NOT_CONFIRMED',
                message: `Đơn lô đang ở trạng thái ${order.status} — phải được duyệt trước khi xuất hóa đơn cả lô.`,
            })
        }

        const lines: InvoiceDraftLine[] = []
        let subtotal = new Prisma.Decimal(0)
        let discountTotal = new Prisma.Decimal(0)
        let taxTotal = new Prisma.Decimal(0)

        for (const orderLine of order.lines) {
            const qty = new Prisma.Decimal(orderLine.orderedActualQty)
            if (!qty.greaterThan(0)) continue
            const unitPrice = new Prisma.Decimal(orderLine.unitPrice)
            const gross = qty.mul(unitPrice)
            const discount = new Prisma.Decimal(orderLine.discountAmount).mul(qty)
            const netAmount = gross.minus(discount)
            const taxRate = orderLine.taxRate == null ? null : new Prisma.Decimal(orderLine.taxRate)
            const taxAmount = taxRate ? netAmount.mul(taxRate) : new Prisma.Decimal(0)

            lines.push({
                salesOrderLineId: orderLine.id,
                salesDeliveryLineId: null,
                productId: orderLine.productId,
                description: orderLine.product.name,
                uom: orderLine.product.uom,
                qty,
                unitPrice,
                discountAmount: discount,
                taxRate,
                netAmount,
                taxAmount,
                lineTotal: netAmount.plus(taxAmount),
            })
            subtotal = subtotal.plus(gross)
            discountTotal = discountTotal.plus(discount)
            taxTotal = taxTotal.plus(taxAmount)
        }
        if (!lines.length) {
            throw new BadRequestException({
                code: 'INVOICE_NO_BILLABLE_LINE',
                message: 'Đơn lô không có dòng nào để lập hóa đơn.',
            })
        }

        return {
            order,
            lines,
            totals: {
                subtotal,
                discountTotal,
                taxTotal,
                grandTotal: subtotal.minus(discountTotal).plus(taxTotal),
            },
        }
    }

    private async buildDraft(
        db: Prisma.TransactionClient | PrismaService,
        source: InvoiceSourceDto,
    ) {
        if (!source.salesOrderId === !source.withdrawalRequestId) {
            throw new BadRequestException({
                code: 'INVOICE_SOURCE_INVALID',
                message: 'Phải chỉ rõ đúng một nguồn: đơn bán hoặc yêu cầu rút lô.',
            })
        }

        // Đơn lô chốt hóa đơn ngay khi xác nhận thì lúc lập chưa có lệnh xuất nào —
        // hóa đơn dựng thẳng từ dòng đơn, cho cả lô.
        if (source.salesOrderId) {
            const lotOrder = await db.salesOrder.findUnique({
                where: { id: source.salesOrderId },
                select: { kind: true, lotInvoiceMode: true },
            })
            if (
                lotOrder?.kind === SalesOrderKind.LOT &&
                lotOrder.lotInvoiceMode === SalesLotInvoiceMode.ON_CONFIRMATION
            ) {
                return this.buildWholeLotDraft(db, source.salesOrderId)
            }
        }

        const deliveries = await db.salesDelivery.findMany({
            where: {
                status: SalesDeliveryStatus.POSTED,
                ...(source.withdrawalRequestId
                    ? { withdrawalRequestId: source.withdrawalRequestId }
                    : { salesOrderId: source.salesOrderId, withdrawalRequestId: null }),
            },
            include: {
                lines: {
                    include: {
                        orderLine: {
                            include: { product: { select: { id: true, code: true, name: true, uom: true } } },
                        },
                    },
                },
            },
            orderBy: { deliveryNo: 'asc' },
        })
        if (!deliveries.length) {
            throw new BadRequestException({
                code: 'INVOICE_NO_POSTED_DELIVERY',
                message: 'Chưa có lệnh xuất kho thành công để lập hóa đơn.',
            })
        }

        // Reconciliation must be settled first (spec v1.2 §4.1, §10.1).
        const reconciliation = await db.salesReconciliation.findFirst({
            where: source.withdrawalRequestId
                ? { withdrawalRequestId: source.withdrawalRequestId }
                : { salesOrderId: source.salesOrderId! },
            include: {
                lines: {
                    where: {
                        supersededById: null,
                        delivery: { status: { not: SalesDeliveryStatus.VOIDED } },
                    },
                    select: { status: true },
                },
            },
        })
        const settled =
            !!reconciliation &&
            reconciliation.lines.length > 0 &&
            reconciliation.lines.every(
                (line) =>
                    line.status === SalesReconciliationStatus.MATCHED ||
                    line.status === SalesReconciliationStatus.RESOLVED,
            )
        if (!settled) {
            throw new BadRequestException({
                code: 'INVOICE_RECONCILIATION_NOT_SETTLED',
                message: 'Đối soát chưa hoàn tất, chưa đủ điều kiện lập hóa đơn.',
            })
        }

        const orderId = source.salesOrderId ?? deliveries[0].salesOrderId
        const order = await db.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: {
                customer: {
                    select: {
                        id: true,
                        name: true,
                        taxCode: true,
                        billingAddress: true,
                        contactEmail: true,
                        accountingOwnerEmpId: true,
                    },
                },
            },
        })

        const lines: InvoiceDraftLine[] = []
        let subtotal = new Prisma.Decimal(0)
        let discountTotal = new Prisma.Decimal(0)
        let taxTotal = new Prisma.Decimal(0)

        for (const delivery of deliveries) {
            for (const line of delivery.lines) {
                const qty = new Prisma.Decimal(line.actualQty ?? 0)
                if (!qty.greaterThan(0)) continue
                const orderLine = line.orderLine
                const unitPrice = new Prisma.Decimal(orderLine.unitPrice)
                const gross = qty.mul(unitPrice)
                // discountAmount là chiết khấu TRÊN MỖI ĐƠN VỊ (Decimal(24,8) như đơn giá),
                // đúng như đơn đặt hàng của kinh doanh: thành tiền = SL × (giá − chiết khấu).
                const discount = new Prisma.Decimal(orderLine.discountAmount).mul(qty)
                const netAmount = gross.minus(discount)
                // taxRate is a fraction (0.1 = 10%), enforced by a 0..1 DB check on the line.
                const taxRate = orderLine.taxRate == null ? null : new Prisma.Decimal(orderLine.taxRate)
                const taxAmount = taxRate ? netAmount.mul(taxRate) : new Prisma.Decimal(0)

                lines.push({
                    salesOrderLineId: orderLine.id,
                    salesDeliveryLineId: line.id,
                    productId: orderLine.productId,
                    description: orderLine.product.name,
                    uom: orderLine.product.uom,
                    qty,
                    unitPrice,
                    discountAmount: discount,
                    taxRate,
                    netAmount,
                    taxAmount,
                    lineTotal: netAmount.plus(taxAmount),
                })
                subtotal = subtotal.plus(gross)
                discountTotal = discountTotal.plus(discount)
                taxTotal = taxTotal.plus(taxAmount)
            }
        }
        if (!lines.length) {
            throw new BadRequestException({
                code: 'INVOICE_NO_BILLABLE_LINE',
                message: 'Không có dòng thực xuất nào để lập hóa đơn.',
            })
        }

        const grandTotal = subtotal.minus(discountTotal).plus(taxTotal)
        return {
            order,
            lines,
            totals: { subtotal, discountTotal, taxTotal, grandTotal },
        }
    }

    /** Read-only preview for the accountant before anything is written. */
    async preview(source: InvoiceSourceDto) {
        const draft = await this.buildDraft(this.prisma, source)
        return {
            buyer: {
                name: draft.order.customer.name,
                taxCode: draft.order.customer.taxCode,
                address: draft.order.customer.billingAddress,
                email: draft.order.customer.contactEmail,
            },
            currency: draft.order.currency,
            lines: draft.lines.map((line, index) => ({
                lineNo: index + 1,
                ...line,
                qty: line.qty.toString(),
                unitPrice: line.unitPrice.toString(),
                discountAmount: line.discountAmount.toString(),
                taxRate: line.taxRate?.toString() ?? null,
                netAmount: line.netAmount.toString(),
                taxAmount: line.taxAmount.toString(),
                lineTotal: line.lineTotal.toString(),
            })),
            totals: {
                subtotal: draft.totals.subtotal.toString(),
                discountTotal: draft.totals.discountTotal.toString(),
                taxTotal: draft.totals.taxTotal.toString(),
                grandTotal: draft.totals.grandTotal.toString(),
            },
        }
    }

    /**
     * Creates the DRAFT invoice, including its internal number, BEFORE any external call.
     * That number doubles as the MISA transaction key so a retry is always recoverable.
     */
    async createDraft(source: InvoiceSourceDto, actor: ScopedActor) {
        const invoiceId = await this.prisma.$transaction(async (tx) => {
            const draft = await this.buildDraft(tx, source)
            const existing = await tx.salesInvoice.findFirst({
                where: {
                    documentType: SalesInvoiceDocumentType.ORIGINAL,
                    status: { not: SalesInvoiceStatus.CANCELLED },
                    ...(source.withdrawalRequestId
                        ? { withdrawalRequestId: source.withdrawalRequestId }
                        : { salesOrderId: source.salesOrderId! }),
                },
                select: { id: true },
            })
            if (existing) return existing.id

            const invoiceDate = new Date()
            const paymentTermDays =
                draft.order.paymentTermType === PaymentTermType.NET_DAYS
                    ? draft.order.paymentTermDays
                    : 0
            const dueDate = new Date(invoiceDate)
            dueDate.setDate(dueDate.getDate() + (paymentTermDays ?? 0))

            const invoice = await tx.salesInvoice.create({
                data: {
                    invoiceNoInternal: await this.nextInvoiceNo(tx, invoiceDate),
                    salesOrderId: source.withdrawalRequestId ? null : source.salesOrderId!,
                    withdrawalRequestId: source.withdrawalRequestId ?? null,
                    documentType: SalesInvoiceDocumentType.ORIGINAL,
                    status: SalesInvoiceStatus.DRAFT,
                    legalEntityId: draft.order.legalEntityId,
                    customerPartyId: draft.order.customerPartyId,
                    accountantEmployeeId: draft.order.customer.accountingOwnerEmpId,
                    // Buyer details frozen here: later master-data edits must not rewrite the document.
                    buyerName: draft.order.customer.name,
                    buyerTaxCode: draft.order.customer.taxCode,
                    buyerAddress: draft.order.customer.billingAddress,
                    buyerEmail: draft.order.customer.contactEmail,
                    currency: draft.order.currency,
                    subtotal: draft.totals.subtotal,
                    discountTotal: draft.totals.discountTotal,
                    taxTotal: draft.totals.taxTotal,
                    grandTotal: draft.totals.grandTotal,
                    invoiceDate,
                    paymentTermDays,
                    dueDate,
                    createdById: actor.userId,
                    lines: {
                        create: draft.lines.map((line, index) => ({
                            lineNo: index + 1,
                            salesOrderLineId: line.salesOrderLineId,
                            salesDeliveryLineId: line.salesDeliveryLineId,
                            productId: line.productId,
                            description: line.description,
                            uom: line.uom,
                            qty: line.qty,
                            unitPrice: line.unitPrice,
                            discountAmount: line.discountAmount,
                            taxRate: line.taxRate,
                            netAmount: line.netAmount,
                            taxAmount: line.taxAmount,
                            lineTotal: line.lineTotal,
                        })),
                    },
                },
                select: { id: true },
            })
            await this.events.record(tx, {
                entityType: 'SALES_INVOICE',
                entityId: invoice.id,
                eventType: 'CREATE',
                toStatus: SalesInvoiceStatus.DRAFT,
                actorId: actor.userId,
            })
            return invoice.id
        })
        return this.detail(invoiceId)
    }

    /**
     * Publishes to MISA. Safe to call again after a crash: it asks MISA about the transaction
     * key first, so an invoice that already went out is recovered instead of duplicated.
     */
    /**
     * Chặn tín dụng đúng ở đây chứ không phải ở bước đặt hàng: hóa đơn phát hành ra mới
     * đẻ ra khoản phải thu, nên đây là mốc cuối cùng còn dừng lại được.
     *
     * Bỏ qua với hóa đơn điều chỉnh/thay thế: chúng sửa một hóa đơn đã ra, chặn lại chỉ
     * làm kẹt việc sửa sai. Đặt SALES_CREDIT_LIMIT_CHECK=0 để tắt tạm.
     */
    private async assertCreditAllows(invoice: {
        id: string
        customerPartyId: string
        documentType: SalesInvoiceDocumentType
        grandTotal: Prisma.Decimal
    }) {
        if (process.env.SALES_CREDIT_LIMIT_CHECK === '0') return
        if (invoice.documentType !== SalesInvoiceDocumentType.ORIGINAL) return

        const credit = await this.checks.creditStatus(this.prisma, invoice.customerPartyId, {
            extraExposure: invoice.grandTotal,
        })

        if (credit.overdueAmount.greaterThan(0)) {
            throw new BadRequestException({
                code: 'CUSTOMER_HAS_OVERDUE_DEBT',
                message: `Khách hàng đang có công nợ quá hạn ${credit.overdueAmount.toFixed(0)} — không phát hành được hóa đơn.`,
                detail: { overdueAmount: credit.overdueAmount.toString() },
            })
        }
        if (credit.limit != null && credit.exposure.greaterThan(new Prisma.Decimal(credit.limit))) {
            throw new BadRequestException({
                code: 'CREDIT_LIMIT_EXCEEDED',
                message: `Phát hành hóa đơn này sẽ đưa công nợ lên ${credit.exposure.toFixed(0)}, vượt hạn mức ${new Prisma.Decimal(credit.limit).toFixed(0)}.`,
                detail: {
                    exposure: credit.exposure.toString(),
                    creditLimit: String(credit.limit),
                    invoiceAmount: invoice.grandTotal.toString(),
                },
            })
        }
    }

    async issue(invoiceId: string, actor: ScopedActor) {
        const invoice = await this.prisma.salesInvoice.findUnique({
            where: { id: invoiceId },
            include: { lines: { orderBy: { lineNo: 'asc' } } },
        })
        if (!invoice) throw new NotFoundException('SALES_INVOICE_NOT_FOUND')
        if (invoice.status === SalesInvoiceStatus.ISSUED) return this.detail(invoiceId)
        if (invoice.status === SalesInvoiceStatus.CANCELLED) {
            throw new BadRequestException({
                code: 'SALES_INVOICE_CANCELLED',
                message: 'Hóa đơn đã hủy, không phát hành lại được.',
            })
        }

        // Kiểm trước khi động vào MISA: đã gửi đi rồi thì không rút lại được nữa.
        await this.assertCreditAllows(invoice)

        const attempt =
            (await this.prisma.salesInvoiceIssuance.count({
                where: { salesInvoiceId: invoiceId, action: 'PUBLISH' },
            })) + 1
        const transactionKey = invoice.invoiceNoInternal

        await this.prisma.salesInvoice.update({
            where: { id: invoiceId },
            data: { status: SalesInvoiceStatus.PENDING_ISSUE, version: { increment: 1 } },
        })

        // Recovery first: a previous attempt may have reached MISA before we crashed.
        if (attempt > 1) {
            const statusLog = await this.prisma.salesInvoiceIssuance.create({
                data: {
                    salesInvoiceId: invoiceId,
                    attempt,
                    action: 'GET_STATUS',
                    status: 'STARTED',
                    requestPayload: { transactionId: transactionKey } as Prisma.InputJsonObject,
                },
            })
            let known
            try {
                known = await this.misa.getStatus(transactionKey)
            } catch (error) {
                // MISA unreachable: leave the invoice failed and say so, never publish blind.
                const message = error instanceof Error ? error.message : String(error)
                await this.prisma.salesInvoiceIssuance.update({
                    where: { id: statusLog.id },
                    data: {
                        status: 'FAILED',
                        errorMessage: message.slice(0, 2000),
                        finishedAt: new Date(),
                    },
                })
                await this.markFailed(invoiceId, 'MISA_STATUS_UNAVAILABLE', message, actor)
                throw error
            }
            await this.prisma.salesInvoiceIssuance.update({
                where: { id: statusLog.id },
                data: {
                    status: 'SUCCESS',
                    responsePayload: this.misa.maskPayload(known) as Prisma.InputJsonObject,
                    finishedAt: new Date(),
                },
            })
            if (known.published) {
                return this.markIssued(invoiceId, known, actor, 'RECOVERED')
            }
        }

        const request = {
            transactionId: transactionKey,
            invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
            buyerName: invoice.buyerName,
            buyerTaxCode: invoice.buyerTaxCode,
            buyerAddress: invoice.buyerAddress,
            buyerEmail: invoice.buyerEmail,
            currency: invoice.currency,
            subtotal: invoice.subtotal.toString(),
            discountTotal: invoice.discountTotal.toString(),
            taxTotal: invoice.taxTotal.toString(),
            grandTotal: invoice.grandTotal.toString(),
            lines: invoice.lines.map((line) => ({
                lineNo: line.lineNo,
                description: line.description,
                uom: line.uom,
                qty: line.qty.toString(),
                unitPrice: line.unitPrice.toString(),
                discountAmount: line.discountAmount.toString(),
                taxRate: line.taxRate?.toString() ?? null,
                netAmount: line.netAmount.toString(),
                taxAmount: line.taxAmount.toString(),
                lineTotal: line.lineTotal.toString(),
            })),
        }

        // Log before the call so a crash mid-flight is visible in the audit trail.
        const log = await this.prisma.salesInvoiceIssuance.create({
            data: {
                salesInvoiceId: invoiceId,
                attempt,
                action: 'PUBLISH',
                status: 'STARTED',
                requestPayload: this.misa.maskPayload(request) as Prisma.InputJsonObject,
            },
        })

        let result
        try {
            result = await this.misa.publish(request)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await this.prisma.salesInvoiceIssuance.update({
                where: { id: log.id },
                data: { status: 'FAILED', errorMessage: message.slice(0, 2000), finishedAt: new Date() },
            })
            await this.markFailed(invoiceId, 'MISA_CALL_FAILED', message, actor)
            throw new ConflictException({
                code: 'MISA_PUBLISH_FAILED',
                message: `Gọi MISA thất bại: ${message}`,
            })
        }

        await this.prisma.salesInvoiceIssuance.update({
            where: { id: log.id },
            data: {
                status: result.ok ? 'SUCCESS' : 'FAILED',
                responsePayload: this.misa.maskPayload(result.raw) as Prisma.InputJsonObject,
                httpStatus: result.httpStatus ?? null,
                errorCode: result.errorCode ?? null,
                errorMessage: result.errorMessage ?? null,
                finishedAt: new Date(),
            },
        })

        if (!result.ok) {
            await this.markFailed(invoiceId, result.errorCode, result.errorMessage, actor)
            throw new ConflictException({
                code: 'MISA_PUBLISH_REJECTED',
                message: result.errorMessage ?? 'MISA từ chối phát hành hóa đơn.',
                errorCode: result.errorCode,
                retryable: isRetryableMisaError(result.errorCode),
            })
        }

        return this.markIssued(
            invoiceId,
            { invoiceNo: result.invoiceNo, templateNo: result.templateNo, serial: result.serial },
            actor,
            'PUBLISHED',
        )
    }

    /** Records success and opens the receivable in one transaction. */
    private async markIssued(
        invoiceId: string,
        misaResult: { invoiceNo?: string; templateNo?: string; serial?: string },
        actor: ScopedActor,
        eventType: string,
    ) {
        await this.prisma.$transaction(async (tx) => {
            const invoice = await tx.salesInvoice.findUniqueOrThrow({
                where: { id: invoiceId },
                include: {
                    salesOrder: { select: { id: true, orderNo: true, createdById: true, submittedById: true } },
                    withdrawalRequest: {
                        select: { id: true, requestNo: true, createdById: true, submittedById: true },
                    },
                },
            })
            if (invoice.status === SalesInvoiceStatus.ISSUED) return

            const issuedAt = new Date()
            await tx.salesInvoice.update({
                where: { id: invoiceId },
                data: {
                    status: SalesInvoiceStatus.ISSUED,
                    misaTransactionId: invoice.invoiceNoInternal,
                    misaInvoiceNo: misaResult.invoiceNo ?? null,
                    misaTemplateNo: misaResult.templateNo ?? null,
                    misaSerial: misaResult.serial ?? null,
                    issuedAt,
                    version: { increment: 1 },
                },
            })

            // Issued invoice ⇒ the customer owes us. Idempotent by document.
            await this.receivables.openItemForOrder(tx, {
                salesInvoiceId: invoiceId,
                amount: invoice.grandTotal,
                currency: invoice.currency,
                legalEntityId: invoice.legalEntityId,
                customerPartyId: invoice.customerPartyId,
                dueDate: invoice.dueDate,
                note: `Hóa đơn ${invoice.invoiceNoInternal}`,
                actorId: actor.userId,
                effectiveAt: issuedAt,
            })

            // A SINGLE order is done once its invoice is out; a LOT order stays open for
            // further draws and closes on its own balance (GĐ 5).
            if (invoice.salesOrderId && !invoice.withdrawalRequestId) {
                await tx.salesOrder.updateMany({
                    where: { id: invoice.salesOrderId, status: SalesOrderStatus.AWAITING_INVOICE },
                    data: { status: SalesOrderStatus.COMPLETED, version: { increment: 1 } },
                })
            }

            await this.events.record(tx, {
                entityType: 'SALES_INVOICE',
                entityId: invoiceId,
                eventType,
                toStatus: SalesInvoiceStatus.ISSUED,
                actorId: actor.userId,
                metadata: { misaInvoiceNo: misaResult.invoiceNo ?? null },
            })

            const docNo = invoice.salesOrder?.orderNo ?? invoice.withdrawalRequest?.requestNo ?? ''
            const owners = [
                invoice.salesOrder?.createdById,
                invoice.salesOrder?.submittedById,
                invoice.withdrawalRequest?.createdById,
                invoice.withdrawalRequest?.submittedById,
            ].filter((value): value is string => !!value)
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.INVOICE_ISSUED,
                    aggregateType: 'SALES_INVOICE',
                    aggregateId: invoiceId,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.INVOICE_ISSUED}:${invoiceId}`,
                    payload: {
                        entityType: 'SALES_INVOICE',
                        entityId: invoiceId,
                        resolvedActions: ['RETRY_SALES_INVOICE'],
                        workItemSourceType: 'SALES_INVOICE',
                        workItemSourceId: invoiceId,
                        invoiceNo: misaResult.invoiceNo ?? invoice.invoiceNoInternal,
                        orderNo: docNo,
                        customerName: invoice.buyerName,
                        grandTotal: invoice.grandTotal.toString(),
                        recipientUserIds: owners,
                        recipientPermissionCodes: [PERMISSIONS.sales.receivableAllocate],
                        excludeUserIds: actor.userId ? [actor.userId] : [],
                    },
                },
                tx,
            )
        })
        return this.detail(invoiceId)
    }

    private async markFailed(
        invoiceId: string,
        errorCode: string | null | undefined,
        errorMessage: string | null | undefined,
        actor: ScopedActor,
    ) {
        await this.prisma.$transaction(async (tx) => {
            const invoice = await tx.salesInvoice.findUniqueOrThrow({
                where: { id: invoiceId },
                select: { invoiceNoInternal: true, version: true, buyerName: true },
            })
            await tx.salesInvoice.update({
                where: { id: invoiceId },
                data: { status: SalesInvoiceStatus.ISSUE_FAILED, version: { increment: 1 } },
            })
            await this.events.record(tx, {
                entityType: 'SALES_INVOICE',
                entityId: invoiceId,
                eventType: 'ISSUE_FAILED',
                toStatus: SalesInvoiceStatus.ISSUE_FAILED,
                actorId: actor.userId,
                reason: errorMessage ?? errorCode ?? null,
            })
            const attempt = await tx.salesInvoiceIssuance.count({
                where: { salesInvoiceId: invoiceId, action: 'PUBLISH' },
            })
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.INVOICE_ISSUE_FAILED,
                    aggregateType: 'SALES_INVOICE',
                    aggregateId: invoiceId,
                    // A new attempt must raise a fresh task, so the key carries the attempt.
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.INVOICE_ISSUE_FAILED}:${invoiceId}:attempt${attempt}`,
                    payload: {
                        entityType: 'SALES_INVOICE',
                        entityId: invoiceId,
                        workItemSourceType: 'SALES_INVOICE',
                        workItemSourceId: invoiceId,
                        actionRequired: true,
                        sourceVersion: attempt,
                        invoiceNo: invoice.invoiceNoInternal,
                        customerName: invoice.buyerName,
                        errorMessage: errorMessage ?? errorCode ?? 'Lỗi không xác định',
                        recipientPermissionCodes: [PERMISSIONS.sales.invoiceIssue],
                    },
                },
                tx,
            )
        })
    }

    /**
     * Cancels an issued invoice (spec v1.2 D8): a status change on the document itself,
     * logged as a MISA call, with a compensating receivable entry. A new ORIGINAL may then
     * be issued for the same commercial document.
     */
    async cancel(invoiceId: string, dto: CancelSalesInvoiceDto, actor: ScopedActor) {
        const reason = dto.reason?.trim()
        if (!reason) {
            throw new BadRequestException({
                code: 'CANCEL_REASON_REQUIRED',
                message: 'Hủy hóa đơn bắt buộc nhập lý do.',
            })
        }
        const invoice = await this.prisma.salesInvoice.findUnique({ where: { id: invoiceId } })
        if (!invoice) throw new NotFoundException('SALES_INVOICE_NOT_FOUND')
        if (invoice.status === SalesInvoiceStatus.CANCELLED) return this.detail(invoiceId)

        if (invoice.status === SalesInvoiceStatus.ISSUED) {
            const attempt =
                (await this.prisma.salesInvoiceIssuance.count({
                    where: { salesInvoiceId: invoiceId, action: 'CANCEL' },
                })) + 1
            const log = await this.prisma.salesInvoiceIssuance.create({
                data: {
                    salesInvoiceId: invoiceId,
                    attempt,
                    action: 'CANCEL',
                    status: 'STARTED',
                    requestPayload: { transactionId: invoice.invoiceNoInternal, reason } as Prisma.InputJsonObject,
                },
            })
            const result = await this.misa.cancel(invoice.invoiceNoInternal, reason)
            await this.prisma.salesInvoiceIssuance.update({
                where: { id: log.id },
                data: {
                    // MANUAL_REQUIRED makes it obvious in the audit trail that the invoice
                    // still has to be cancelled inside meInvoice by hand.
                    status: result.ok
                        ? result.manualActionRequired
                            ? 'MANUAL_REQUIRED'
                            : 'SUCCESS'
                        : 'FAILED',
                    responsePayload: this.misa.maskPayload(result.raw) as Prisma.InputJsonObject,
                    finishedAt: new Date(),
                },
            })
            if (!result.ok) {
                throw new ConflictException({
                    code: 'MISA_CANCEL_FAILED',
                    message: 'MISA từ chối hủy hóa đơn.',
                })
            }
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.salesInvoice.update({
                where: { id: invoiceId },
                data: {
                    status: SalesInvoiceStatus.CANCELLED,
                    cancelledAt: new Date(),
                    cancelledById: actor.userId,
                    cancelReason: reason,
                    version: { increment: 1 },
                },
            })
            // The debt disappears with the document; the ledger keeps its history.
            const openItem = await tx.receivableOpenItem.findUnique({
                where: { salesInvoiceId: invoiceId },
            })
            if (openItem && openItem.status !== 'VOIDED') {
                await tx.receivableLedgerEntry.create({
                    data: {
                        openItemId: openItem.id,
                        type: 'CREDIT_NOTE',
                        amountDelta: openItem.outstandingAmount.negated(),
                        idempotencyKey: `receivable-invoice-cancel:${invoiceId}`,
                        effectiveAt: new Date(),
                    },
                })
                await tx.receivableOpenItem.update({
                    where: { id: openItem.id },
                    data: { outstandingAmount: 0, status: 'VOIDED', version: { increment: 1 } },
                })
            }
            // The order is billable again.
            if (invoice.salesOrderId) {
                await tx.salesOrder.updateMany({
                    where: { id: invoice.salesOrderId, status: SalesOrderStatus.COMPLETED },
                    data: { status: SalesOrderStatus.AWAITING_INVOICE, version: { increment: 1 } },
                })
            }
            await this.events.record(tx, {
                entityType: 'SALES_INVOICE',
                entityId: invoiceId,
                eventType: 'CANCEL',
                fromStatus: invoice.status,
                toStatus: SalesInvoiceStatus.CANCELLED,
                actorId: actor.userId,
                reason,
            })
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.INVOICE_CANCELLED,
                    aggregateType: 'SALES_INVOICE',
                    aggregateId: invoiceId,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.INVOICE_CANCELLED}:${invoiceId}`,
                    payload: {
                        entityType: 'SALES_INVOICE',
                        entityId: invoiceId,
                        invoiceNo: invoice.misaInvoiceNo ?? invoice.invoiceNoInternal,
                        customerName: invoice.buyerName,
                        reasonSummary: reason,
                        recipientPermissionCodes: [
                            PERMISSIONS.sales.invoiceIssue,
                            PERMISSIONS.sales.receivableAllocate,
                        ],
                        excludeUserIds: actor.userId ? [actor.userId] : [],
                    },
                },
                tx,
            )
        })
        return this.detail(invoiceId)
    }

    async list(query: ListSalesInvoicesQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const where: Prisma.SalesInvoiceWhereInput = {
            status: query.status ? (query.status as SalesInvoiceStatus) : undefined,
            customerPartyId: query.customerPartyId ?? undefined,
            accountantEmployeeId: query.accountantEmployeeId ?? undefined,
            salesOrderId: query.salesOrderId ?? undefined,
            withdrawalRequestId: query.withdrawalRequestId ?? undefined,
        }
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.salesInvoice.findMany({
                where,
                include: {
                    customer: { select: { id: true, code: true, name: true } },
                    accountantEmployee: { select: { id: true, code: true, fullName: true } },
                    salesOrder: { select: { id: true, orderNo: true, orderDate: true } },
                    withdrawalRequest: {
                        select: {
                            id: true,
                            requestNo: true,
                            salesOrder: { select: { id: true, orderNo: true, orderDate: true } },
                        },
                    },
                    lines: {
                        orderBy: { lineNo: 'asc' },
                        select: { description: true, product: { select: { code: true, name: true } } },
                    },
                },
                orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.salesInvoice.count({ where }),
        ])
        return { items: rows, total, page, limit }
    }

    /**
     * Documents that accounting may turn into a first/original invoice. They are deliberately
     * separate from SalesInvoice rows because no invoice record exists yet for this tab.
     */
    async listUnissued(query: ListUnissuedSalesInvoicesQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const customerWhere = {
            id: query.customerPartyId ?? undefined,
            accountingOwnerEmpId: query.accountantEmployeeId ?? undefined,
        }
        const liveOriginal = {
            none: {
                documentType: SalesInvoiceDocumentType.ORIGINAL,
                status: { not: SalesInvoiceStatus.CANCELLED },
            },
        }
        const [orders, withdrawals] = await this.prisma.$transaction([
            this.prisma.salesOrder.findMany({
                where: {
                    customer: customerWhere,
                    invoices: liveOriginal,
                    OR: [
                        { kind: SalesOrderKind.SINGLE, status: SalesOrderStatus.AWAITING_INVOICE },
                        {
                            kind: SalesOrderKind.LOT,
                            lotInvoiceMode: SalesLotInvoiceMode.ON_CONFIRMATION,
                            status: { in: invoiceableLotStatuses },
                        },
                    ],
                },
                select: {
                    id: true,
                    orderNo: true,
                    orderDate: true,
                    kind: true,
                    customer: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            accountingOwnerEmp: { select: { id: true, code: true, fullName: true } },
                        },
                    },
                    lines: {
                        select: {
                            orderedActualQty: true,
                            unitPrice: true,
                            discountAmount: true,
                            taxRate: true,
                            product: { select: { code: true } },
                        },
                    },
                },
            }),
            this.prisma.salesLotWithdrawalRequest.findMany({
                where: {
                    status: SalesWithdrawalStatus.ISSUED,
                    customer: customerWhere,
                    invoices: liveOriginal,
                },
                select: {
                    id: true,
                    requestNo: true,
                    requestDate: true,
                    customer: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            accountingOwnerEmp: { select: { id: true, code: true, fullName: true } },
                        },
                    },
                    salesOrder: { select: { orderNo: true, orderDate: true } },
                    lines: {
                        select: {
                            requestedQty: true,
                            product: { select: { code: true } },
                            orderLine: {
                                select: { unitPrice: true, discountAmount: true, taxRate: true },
                            },
                        },
                    },
                },
            }),
        ])
        const items = [
            ...orders.map((order) => ({
                id: `order:${order.id}`,
                source: { salesOrderId: order.id },
                sourceNo: order.orderNo,
                sourceType: order.kind === SalesOrderKind.LOT ? 'LOT_ORDER' : 'SALES_ORDER',
                sourceDate: order.orderDate,
                customer: order.customer,
                accountantEmployee: order.customer.accountingOwnerEmp,
                ...this.summarizeUnissuedLines(order.lines.map((line) => ({
                    qty: line.orderedActualQty,
                    unitPrice: line.unitPrice,
                    discountAmount: line.discountAmount,
                    taxRate: line.taxRate,
                    productCode: line.product.code,
                }))),
            })),
            ...withdrawals.map((request) => ({
                id: `withdrawal:${request.id}`,
                source: { withdrawalRequestId: request.id },
                sourceNo: request.salesOrder?.orderNo ?? request.requestNo,
                sourceType: 'WITHDRAWAL',
                sourceDate: request.salesOrder?.orderDate ?? request.requestDate,
                customer: request.customer,
                accountantEmployee: request.customer.accountingOwnerEmp,
                ...this.summarizeUnissuedLines(request.lines.flatMap((line) => line.orderLine ? [{
                    qty: line.requestedQty,
                    unitPrice: line.orderLine.unitPrice,
                    discountAmount: line.orderLine.discountAmount,
                    taxRate: line.orderLine.taxRate,
                    productCode: line.product.code,
                }] : [])),
            })),
        ].sort((a, b) => b.sourceDate.getTime() - a.sourceDate.getTime())
        return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit }
    }

    async detail(id: string) {
        const invoice = await this.prisma.salesInvoice.findUnique({
            where: { id },
            include: detailInclude,
        })
        if (!invoice) throw new NotFoundException('SALES_INVOICE_NOT_FOUND')
        return invoice
    }
}
