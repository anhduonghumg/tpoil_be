import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common'
import {
    PaymentTermType,
    Prisma,
    SalesDeliveryStatus,
    SalesInvoiceDocumentType,
    SalesInvoiceStatus,
    SalesLotInvoiceMode,
    SalesOrderKind,
    SalesOrderStatus,
    InvoiceEnvironment,
    SalesWithdrawalStatus,
    SalesReconciliationStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { MisaClientService, isRetryableMisaError, vatRateName } from 'src/infra/misa/misa-client.service'
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
    IssueSalesInvoiceDto,
    UpdateInvoiceProviderConfigDto,
} from './dto/sales-invoice.dto'
import { createHash } from 'crypto'
import { AccountingInventoryService } from 'src/modules/inventory/accounting-inventory.service'

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
    // Người bán cho bản in hóa đơn trong hệ thống — thông tin pháp nhân nằm ở Party.
    legalEntity: {
        select: {
            id: true,
            code: true,
            party: {
                select: {
                    name: true,
                    taxCode: true,
                    billingAddress: true,
                    bankAccountNo: true,
                },
            },
        },
    },
    accountantEmployee: { select: { id: true, code: true, fullName: true } },
    salesOrder: { select: { id: true, orderNo: true, orderDate: true, kind: true } },
    withdrawalRequest: { select: { id: true, requestNo: true, requestDate: true } },
    lines: {
        orderBy: { lineNo: 'asc' },
        include: { product: { select: { id: true, code: true, name: true, uom: true } } },
    },
    issuances: { orderBy: { startedAt: 'desc' }, take: 20 },
    receivableItems: {
        orderBy: { installmentNo: 'asc' },
        select: {
            id: true,
            installmentNo: true,
            originalAmount: true,
            outstandingAmount: true,
            status: true,
            dueDate: true,
        },
    },
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
    /** Nhãn gửi cho MISA ("10%", "KCT"). Null = suy từ con số như trước. */
    taxRateName: string | null
    netAmount: Prisma.Decimal
    taxAmount: Prisma.Decimal
    lineTotal: Prisma.Decimal
}

/** Phần của một dòng thuế mà bước lập hóa đơn cần tới. */
type VatRateSource = { rate: Prisma.Decimal; isExempt: boolean }

/** Dòng thuế đã chọn trên dòng đơn bán, đúng phần mà bước lập hóa đơn cần. */
type OrderLineVat = {
    taxRate: Prisma.Decimal | null
    vatRate?: VatRateSource | null
}

/** Chỉ những cột của VatRate mà bước lập hóa đơn dùng tới. */
const VAT_RATE_SELECT = { select: { rate: true, isExempt: true } } as const

/**
 * Thuế của một dòng hóa đơn.
 *
 * Dòng thuế đã chọn là nguồn sự thật: con số trần không phân biệt được "không chịu thuế"
 * (KCT) với "thuế suất 0%" — hai nghiệp vụ khác nhau nhưng cùng ra 0. Dòng nào chưa gắn
 * dòng thuế thì giữ nguyên hành vi cũ, để đơn nhập từ trước không đổi số.
 *
 * Nhãn dựng bằng vatRateName để thuế suất lạ bị chặn ngay lúc dựng nháp, chứ không đợi
 * MISA từ chối sau khi đã tiêu mất một số hóa đơn.
 */
function vatOf(orderLine: OrderLineVat, fallback: VatRateSource | null) {
    // Mặc định chỉ đỡ cho dòng KHÔNG nói gì về thuế. Dòng đã ghi sẵn con số thì giữ
    // nguyên con số đó — đơn cũ nhập tay không được đổi vì một cài đặt sau này.
    const vat = orderLine.vatRate ?? (orderLine.taxRate == null ? fallback : null)
    if (!vat) {
        const rate = orderLine.taxRate == null ? null : new Prisma.Decimal(orderLine.taxRate)
        return { taxRate: rate, taxRateName: null as string | null }
    }
    if (vat.isExempt) return { taxRate: null, taxRateName: vatRateName(null) }
    // VatRate.rate lưu theo phần trăm (10.00), còn dòng đơn lưu theo phân số (0.1).
    const rate = new Prisma.Decimal(vat.rate).div(100)
    return { taxRate: rate, taxRateName: vatRateName(rate.toString()) }
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
        private readonly accountingInventory: AccountingInventoryService,
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

    /**
     * Tổng dự kiến để kế toán thấy ngay ở danh sách chưa xuất HĐ. Hóa đơn nháp vẫn được
     * dựng lại từ dữ liệu thực xuất trước khi lưu, nên đây không thay thế bước kiểm tra đó.
     *
     * `discountAmount` của dòng đơn bán là CK trên mỗi đơn vị. Giá hiển thị cho kế toán
     * phải là giá sau CK; thuế mặc định lấy từ đúng cấu hình môi trường đang phát hành,
     * giống `buildDraft`, để danh sách không lệch với hộp xem trước.
     */
    private summarizeUnissuedLines(
        lines: Array<{
            qty: Prisma.Decimal
            unitPrice: Prisma.Decimal
            discountAmount: Prisma.Decimal
            taxRate: Prisma.Decimal | null
            vatRate?: VatRateSource | null
            productCode: string | null
        }>,
        fallbackVat: VatRateSource | null,
    ) {
        const netUnitPrices = new Set<string>()
        const paymentUnitPrices = new Set<string>()
        const taxRateNames = new Set<string>()
        const total = lines.reduce((sum, line) => {
            const netUnitPrice = new Prisma.Decimal(line.unitPrice).minus(line.discountAmount)
            const net = line.qty.mul(netUnitPrice)
            const { taxRate, taxRateName } = vatOf(line, fallbackVat)
            const tax = taxRate ? net.mul(taxRate) : new Prisma.Decimal(0)
            const paymentUnitPrice = taxRate
                ? netUnitPrice.plus(netUnitPrice.mul(taxRate))
                : netUnitPrice

            netUnitPrices.add(netUnitPrice.toString())
            paymentUnitPrices.add(paymentUnitPrice.toString())
            taxRateNames.add(taxRateName ?? (taxRate == null ? 'KCT' : `${taxRate.mul(100).toString()}%`))
            return sum.plus(net).plus(tax)
        }, new Prisma.Decimal(0))
        return {
            itemCodes: [...new Set(lines.map((line) => line.productCode).filter((code): code is string => !!code))],
            estimatedQty: lines
                .reduce((sum, line) => sum.plus(line.qty), new Prisma.Decimal(0))
                .toString(),
            // Giữ giá gốc để tương thích API cũ; UI dùng giá sau CK bên dưới.
            estimatedUnitPrices: [...new Set(lines.map((line) => line.unitPrice.toString()))],
            // Không bình quân các dòng khác giá thành một con số không có thật trên chứng từ.
            estimatedNetUnitPrices: [...netUnitPrices],
            estimatedPaymentUnitPrices: [...paymentUnitPrices],
            estimatedTaxRateNames: [...taxRateNames],
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
    /**
     * Thuế suất mặc định của môi trường đang phát hành, lấy từ màn cấu hình xuất hóa đơn.
     * Chưa đặt thì dòng nào không tự chọn thuế sẽ đi ra thành "không chịu thuế".
     */
    private async defaultVat(db: Prisma.TransactionClient | PrismaService) {
        const config = await db.invoiceProviderConfig.findFirst({
            where: { active: true },
            select: { defaultVatRate: { select: { rate: true, isExempt: true } } },
        })
        return config?.defaultVatRate ?? null
    }

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
                    include: {
                        product: { select: { id: true, name: true, uom: true } },
                        vatRate: VAT_RATE_SELECT,
                    },
                },
                paymentPlans: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] },
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

        const fallbackVat = await this.defaultVat(db)
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
            const { taxRate, taxRateName } = vatOf(orderLine, fallbackVat)
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
                taxRateName,
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

    /** Build an invoice before warehouse issue from quantities already reserved by approval. */
    private async buildReservedDraft(
        db: Prisma.TransactionClient | PrismaService,
        source: InvoiceSourceDto,
    ) {
        let orderId = source.salesOrderId
        let requestedLines: Array<{
            requestLineId: string | null
            orderLineId: string
            qty: Prisma.Decimal
        }> = []

        if (source.withdrawalRequestId) {
            const request = await db.salesLotWithdrawalRequest.findUniqueOrThrow({
                where: { id: source.withdrawalRequestId },
                include: { lines: { orderBy: { lineNo: 'asc' } } },
            })
            if (!request.salesOrderId || !request.approvedAt) {
                throw new BadRequestException({
                    code: 'INVOICE_WITHDRAWAL_NOT_APPROVED',
                    message: 'Phiếu rút phải được duyệt trước khi lập hóa đơn.',
                })
            }
            orderId = request.salesOrderId
            requestedLines = request.lines.map((line) => {
                if (!line.salesOrderLineId) {
                    throw new BadRequestException({
                        code: 'INVOICE_WITHDRAWAL_SOURCE_MISSING',
                        message: `Dòng ${line.lineNo} chưa xác định được dòng đơn lô nguồn.`,
                    })
                }
                return {
                    requestLineId: line.id,
                    orderLineId: line.salesOrderLineId,
                    qty: new Prisma.Decimal(line.requestedQty),
                }
            })
        }

        if (!orderId) {
            throw new BadRequestException({
                code: 'INVOICE_SOURCE_INVALID',
                message: 'Không xác định được đơn bán nguồn của hóa đơn.',
            })
        }
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
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        product: { select: { id: true, name: true, uom: true } },
                        vatRate: VAT_RATE_SELECT,
                    },
                },
                paymentPlans: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] },
            },
        })
        if (!source.withdrawalRequestId) {
            if (!order.approvedAt) {
                throw new BadRequestException({
                    code: 'INVOICE_ORDER_NOT_APPROVED',
                    message: 'Đơn bán phải được duyệt trước khi lập hóa đơn.',
                })
            }
            requestedLines = order.lines.map((line) => ({
                requestLineId: null,
                orderLineId: line.id,
                qty: new Prisma.Decimal(line.orderedActualQty),
            }))
        }

        const reservationLines = await db.inventoryReservationLine.findMany({
            where: {
                activeActualQty: { gt: 0 },
                reservation: source.withdrawalRequestId
                    ? { withdrawalRequestId: source.withdrawalRequestId }
                    : { salesOrderId: orderId, withdrawalRequestId: null },
            },
            select: {
                salesOrderLineId: true,
                withdrawalRequestLineId: true,
                activeActualQty: true,
            },
        })

        const fallbackVat = await this.defaultVat(db)
        const lines: InvoiceDraftLine[] = []
        let subtotal = new Prisma.Decimal(0)
        let discountTotal = new Prisma.Decimal(0)
        let taxTotal = new Prisma.Decimal(0)
        for (const requested of requestedLines) {
            const orderLine = order.lines.find((line) => line.id === requested.orderLineId)
            if (!orderLine) {
                throw new BadRequestException({
                    code: 'INVOICE_ORDER_LINE_NOT_FOUND',
                    message: 'Không tìm thấy dòng đơn bán nguồn của hóa đơn.',
                })
            }
            const held = reservationLines
                .filter((line) =>
                    requested.requestLineId
                        ? line.withdrawalRequestLineId === requested.requestLineId
                        : line.salesOrderLineId === requested.orderLineId,
                )
                .reduce((sum, line) => sum.plus(line.activeActualQty), new Prisma.Decimal(0))
            if (held.lessThan(requested.qty)) {
                throw new BadRequestException({
                    code: 'INVOICE_RESERVED_QTY_INSUFFICIENT',
                    message: `Dòng ${orderLine.lineNo} mới giữ ${held.toString()}, chưa đủ ${requested.qty.toString()} để lập hóa đơn trước xuất kho.`,
                    detail: {
                        salesOrderLineId: orderLine.id,
                        reservedQty: held.toString(),
                        invoiceQty: requested.qty.toString(),
                    },
                })
            }

            const qty = requested.qty
            const unitPrice = new Prisma.Decimal(orderLine.unitPrice)
            const gross = qty.mul(unitPrice)
            const discount = new Prisma.Decimal(orderLine.discountAmount).mul(qty)
            const netAmount = gross.minus(discount)
            const { taxRate, taxRateName } = vatOf(orderLine, fallbackVat)
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
                taxRateName,
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
                message: 'Không có dòng đã giữ hàng nào để lập hóa đơn.',
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
                            include: {
                                product: { select: { id: true, code: true, name: true, uom: true } },
                                vatRate: VAT_RATE_SELECT,
                            },
                        },
                    },
                },
            },
            orderBy: { deliveryNo: 'asc' },
        })
        if (!deliveries.length) return this.buildReservedDraft(db, source)
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
                paymentPlans: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] },
            },
        })

        const fallbackVat = await this.defaultVat(db)
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
                const { taxRate, taxRateName } = vatOf(orderLine, fallbackVat)
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
                    taxRateName,
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
    /** Một môi trường trên màn cấu hình. Bí mật chỉ báo có/không, không bao giờ trả về. */
    private describeConfig(
        row: {
            environment: InvoiceEnvironment
            active: boolean
            baseUrl: string
            taxCode: string
            username: string
            password: string
            appId: string
            templateNo: string
            serial: string
            signType: number
            paymentMethod: string
            publishMinGapMs: number
            defaultVatRateId: string | null
            defaultVatRate?: { id: string; name: string } | null
            mock: boolean
        } | null,
        environment: InvoiceEnvironment,
    ) {
        if (!row) return { environment, configured: false as const }
        const masked = row.username
            ? `${row.username.slice(0, 3)}${'*'.repeat(Math.max(row.username.length - 6, 0))}${row.username.slice(-3)}`
            : null
        return {
            environment,
            configured: true as const,
            active: row.active,
            baseUrl: row.baseUrl,
            taxCode: row.taxCode || null,
            username: masked,
            hasPassword: Boolean(row.password),
            hasAppId: Boolean(row.appId),
            templateNo: row.templateNo || null,
            serial: row.serial || null,
            signType: row.signType,
            paymentMethod: row.paymentMethod,
            publishMinGapMs: row.publishMinGapMs,
            defaultVatRateId: row.defaultVatRateId,
            defaultVatRateName: row.defaultVatRate?.name ?? null,
            mock: row.mock,
        }
    }

    /**
     * Cả hai môi trường cùng lúc, kèm cấu hình đang thực sự được dùng. Bí mật (mật khẩu,
     * appId) không bao giờ rời khỏi máy chủ — chỉ trả về cờ báo đã có hay chưa.
     */
    async misaSettings() {
        const rows = await this.prisma.invoiceProviderConfig.findMany({
            include: { defaultVatRate: { select: { id: true, name: true } } },
        })
        const running = await this.misa.config()
        return {
            provider: 'MISA meInvoice',
            /** ENV = chưa lưu môi trường nào, đang chạy theo biến môi trường máy chủ. */
            source: running.source,
            activeEnvironment: running.source === 'DATABASE' ? running.environment : null,
            /** Cấu hình thực tế đang dùng để phát hành — có thể vẫn đến từ biến môi trường. */
            running: {
                environment: running.environment,
                baseUrl: running.baseUrl,
                serial: running.serial,
                templateNo: running.templateNo,
                mock: running.mock,
            },
            environments: [
                this.describeConfig(
                    rows.find((row) => row.environment === InvoiceEnvironment.TEST) ?? null,
                    InvoiceEnvironment.TEST,
                ),
                this.describeConfig(
                    rows.find((row) => row.environment === InvoiceEnvironment.PRODUCTION) ?? null,
                    InvoiceEnvironment.PRODUCTION,
                ),
            ],
        }
    }

    /**
     * Lưu cấu hình của MỘT môi trường. Lưu không đồng nghĩa với dùng: muốn đổi nơi hóa đơn
     * bay tới phải bấm chuyển riêng, để không ai vừa sửa vài chữ đã vô tình bắn sang MISA thật.
     *
     * Mật khẩu và appId để trống = GIỮ NGUYÊN giá trị cũ — màn cấu hình không bao giờ nhận
     * được giá trị thật nên không thể gửi lại, để trống mà ghi đè thì mất kết nối.
     */
    async updateMisaSettings(dto: UpdateInvoiceProviderConfigDto, actor: ScopedActor) {
        const environment = dto.environment
        const current = await this.prisma.invoiceProviderConfig.findUnique({
            where: { environment },
        })
        const password = dto.password?.trim() || current?.password
        const appId = dto.appId?.trim() || current?.appId
        if (!password || !appId) {
            throw new BadRequestException({
                code: 'MISA_CREDENTIALS_REQUIRED',
                message: 'Lần lưu đầu tiên của môi trường này phải nhập đủ mật khẩu và AppID.',
            })
        }

        const data = {
            provider: 'MISA',
            baseUrl: dto.baseUrl.trim().replace(/\/+$/, ''),
            taxCode: dto.taxCode.trim(),
            username: dto.username.trim(),
            password,
            appId,
            templateNo: dto.templateNo.trim(),
            serial: dto.serial.trim(),
            signType: dto.signType ?? 1,
            paymentMethod: dto.paymentMethod?.trim() || 'TM/CK',
            publishMinGapMs: dto.publishMinGapMs ?? 3000,
            defaultVatRateId: dto.defaultVatRateId ?? null,
            mock: dto.mock ?? false,
            updatedById: actor.userId,
        }

        // Dòng đầu tiên của cả hệ thống thì bật dùng luôn — nếu không sẽ không có cấu hình
        // nào active, và mọi thứ vẫn chạy theo biến môi trường dù người dùng tưởng đã xong.
        const anyActive = await this.prisma.invoiceProviderConfig.count({ where: { active: true } })

        await this.prisma.invoiceProviderConfig.upsert({
            where: { environment },
            create: { environment, active: anyActive === 0, ...data },
            update: { ...data, version: { increment: 1 } },
        })

        this.misa.invalidateConfigCache()
        return this.misaSettings()
    }

    /** Chuyển môi trường đang dùng. Đúng một dòng active, đổi trong một transaction. */
    async activateMisaEnvironment(environment: InvoiceEnvironment) {
        const target = await this.prisma.invoiceProviderConfig.findUnique({
            where: { environment },
        })
        if (!target) {
            throw new BadRequestException({
                code: 'MISA_CONFIG_NOT_FOUND',
                message: 'Môi trường này chưa được cấu hình. Nhập và lưu trước khi chuyển sang dùng.',
            })
        }

        await this.prisma.$transaction([
            this.prisma.invoiceProviderConfig.updateMany({
                where: { environment: { not: environment } },
                data: { active: false },
            }),
            this.prisma.invoiceProviderConfig.update({
                where: { environment },
                data: { active: true },
            }),
        ])

        this.misa.invalidateConfigCache()
        return this.misaSettings()
    }


    /**
     * Link xem bản PDF hóa đơn trên meInvoice.
     *
     * Chỉ mở cho hóa đơn đã phát hành: MISA trả URL kể cả với chứng từ chưa ra hóa đơn,
     * nên phải tự chặn ở đây, không thì người dùng bấm ra một trang tra cứu trống rỗng.
     */
    async documentUrl(invoiceId: string) {
        const invoice = await this.prisma.salesInvoice.findUnique({
            where: { id: invoiceId },
            select: {
                invoiceNoInternal: true,
                status: true,
                misaInvoiceNo: true,
                misaTransactionId: true,
            },
        })
        if (!invoice) throw new NotFoundException('SALES_INVOICE_NOT_FOUND')
        if (invoice.status !== SalesInvoiceStatus.ISSUED) {
            throw new BadRequestException({
                code: 'SALES_INVOICE_NOT_ISSUED',
                message: 'Chỉ xem được bản hóa đơn của chứng từ đã phát hành.',
            })
        }

        // Hỏi bằng mã giao dịch của MISA nếu đã có: /invoice/download từ chối RefID của
        // mình (InvalidTransactionID) nhưng nhận mã MISA, nên đây nhiều khả năng mới là
        // khóa đúng cho nhóm API tài liệu. Hóa đơn cũ chưa lưu mã thì lùi về RefID.
        const lookupKey = invoice.misaTransactionId ?? invoice.invoiceNoInternal
        // Mở thẳng bản PDF MISA. Client MISA chỉ lấy URL và không còn tải thử
        // bằng backend, nên trình duyệt người dùng nhận đúng file gốc từ MISA.
        const url = await this.misa.viewUrl(lookupKey)
        if (!url) {
            throw new BadRequestException({
                code: 'MISA_VIEW_UNAVAILABLE',
                message:
                    'MISA chưa có bản in cho hóa đơn này. Kiểm tra trạng thái phát hành ' +
                    'hoặc thử lại sau.',
            })
        }
        return { url, invoiceNo: invoice.misaInvoiceNo }
    }


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
                taxRateName: line.taxRateName,
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
            const dueDate = draft.order.paymentPlans.at(-1)?.dueDate
                ? new Date(draft.order.paymentPlans.at(-1)!.dueDate)
                : new Date(invoiceDate)
            if (!draft.order.paymentPlans.length) {
                dueDate.setDate(dueDate.getDate() + (paymentTermDays ?? 0))
            }

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
                            taxRateName: line.taxRateName,
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

    private async invoiceCreditAssessment(invoice: {
        id: string
        customerPartyId: string
        documentType: SalesInvoiceDocumentType
        grandTotal: Prisma.Decimal
    }) {
        if (
            process.env.SALES_CREDIT_LIMIT_CHECK === '0' ||
            invoice.documentType !== SalesInvoiceDocumentType.ORIGINAL
        ) {
            return null
        }
        const credit = await this.checks.creditStatus(this.prisma, invoice.customerPartyId)
        const actualDebtBefore = new Prisma.Decimal(credit.receivableOutstanding)
        const actualDebtAfter = actualDebtBefore.plus(invoice.grandTotal)
        const limit = credit.limit == null ? null : new Prisma.Decimal(credit.limit)
        const exceededBy = limit == null
            ? new Prisma.Decimal(0)
            : Prisma.Decimal.max(actualDebtAfter.minus(limit), 0)
        const committedUninvoicedAmount = Prisma.Decimal.max(
            new Prisma.Decimal(credit.exposure).minus(actualDebtBefore),
            0,
        )
        const riskCodes = [
            ...(credit.overdueAmount.greaterThan(0) ? ['CUSTOMER_HAS_OVERDUE_DEBT'] : []),
            ...(exceededBy.greaterThan(0) ? ['CREDIT_LIMIT_EXCEEDED'] : []),
        ]
        const snapshot = {
            invoiceId: invoice.id,
            customerPartyId: invoice.customerPartyId,
            actualDebtBefore: actualDebtBefore.toString(),
            overdueAmount: credit.overdueAmount.toString(),
            committedUninvoicedAmount: committedUninvoicedAmount.toString(),
            invoiceAmount: invoice.grandTotal.toString(),
            actualDebtAfter: actualDebtAfter.toString(),
            creditLimit: limit?.toString() ?? null,
            exceededBy: exceededBy.toString(),
            riskCodes,
        }
        // The hash protects the credit figures at confirmation time. It must
        // not depend on the temporary invoice id: a source invoice can be
        // rebuilt after a preflight validation failure, while the customer
        // debt snapshot is still the same.
        const { invoiceId: _invoiceId, ...hashSnapshot } = snapshot
        return {
            ...snapshot,
            snapshotHash: createHash('sha256').update(JSON.stringify(hashSnapshot)).digest('hex'),
        }
    }

    private canOverrideCredit(actor: ScopedActor) {
        const permissions = new Set(actor.permissions ?? [])
        return permissions.has(PERMISSIONS.system.rbacAdmin) ||
            permissions.has(PERMISSIONS.sales.invoiceCreditOverride)
    }

    private async confirmCreditRisk(
        invoice: {
            id: string
            customerPartyId: string
            documentType: SalesInvoiceDocumentType
            grandTotal: Prisma.Decimal
        },
        actor: ScopedActor,
        dto: IssueSalesInvoiceDto,
    ) {
        const assessment = await this.invoiceCreditAssessment(invoice)
        if (!assessment?.riskCodes.length) return
        if (!dto.overrideCredit) {
            throw new ConflictException({
                code: 'CREDIT_CONFIRMATION_REQUIRED',
                message: 'Công nợ khách hàng đang có cảnh báo. Kế toán cần xác nhận trước khi phát hành hóa đơn.',
                detail: assessment,
            })
        }
        if (!this.canOverrideCredit(actor)) {
            throw new ForbiddenException({
                code: 'CREDIT_OVERRIDE_PERMISSION_REQUIRED',
                message: 'Tài khoản chưa có quyền xác nhận phát hành hóa đơn vượt hạn mức công nợ.',
                detail: assessment,
            })
        }
        if (!dto.creditSnapshotHash || dto.creditSnapshotHash !== assessment.snapshotHash) {
            throw new ConflictException({
                code: 'CREDIT_CONFIRMATION_STALE',
                message: 'Số liệu công nợ đã thay đổi. Vui lòng kiểm tra và xác nhận lại.',
                detail: assessment,
            })
        }
        await this.prisma.$transaction((tx) =>
            this.events.record(tx, {
                entityType: 'SALES_INVOICE',
                entityId: invoice.id,
                eventType: 'CREDIT_OVERRIDE_CONFIRMED',
                actorId: actor.userId,
                metadata: assessment,
            }),
        )
    }

    /** Payload gửi MISA, dùng chung cho cả lập nháp lẫn phát hành. */
    private misaRequestFor(invoice: {
        invoiceNoInternal: string
        invoiceDate: Date
        buyerName: string
        buyerTaxCode: string | null
        buyerAddress: string | null
        buyerEmail: string | null
        currency: string
        subtotal: Prisma.Decimal
        discountTotal: Prisma.Decimal
        taxTotal: Prisma.Decimal
        grandTotal: Prisma.Decimal
        lines: Array<{
            lineNo: number
            description: string
            uom: string
            qty: Prisma.Decimal
            unitPrice: Prisma.Decimal
            discountAmount: Prisma.Decimal
            taxRate: Prisma.Decimal | null
            taxRateName: string | null
            netAmount: Prisma.Decimal
            taxAmount: Prisma.Decimal
            lineTotal: Prisma.Decimal
        }>
    }) {
        return {
            transactionId: invoice.invoiceNoInternal,
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
                taxRateName: line.taxRateName,
                netAmount: line.netAmount.toString(),
                taxAmount: line.taxAmount.toString(),
                lineTotal: line.lineTotal.toString(),
            })),
        }
    }

    async issue(invoiceId: string, actor: ScopedActor, dto: IssueSalesInvoiceDto = {}) {
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
        await this.confirmCreditRisk(invoice, actor, dto)

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

        const request = this.misaRequestFor(invoice)

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
            {
                invoiceNo: result.invoiceNo,
                templateNo: result.templateNo,
                serial: result.serial,
                // MISA trả một TransactionID riêng cho nhóm API tra cứu/PDF.
                // Phải lưu đúng mã này; RefID nội bộ chỉ dùng để chống phát hành trùng.
                misaTransactionId: result.misaTransactionId,
            },
            actor,
            'PUBLISHED',
        )
    }

    /** Records success and opens the receivable in one transaction. */
    private async markIssued(
        invoiceId: string,
        misaResult: {
            invoiceNo?: string
            templateNo?: string
            serial?: string
            /** Mã giao dịch do MISA sinh; luồng khôi phục không có nên để trống được. */
            misaTransactionId?: string
        },
        actor: ScopedActor,
        eventType: string,
    ) {
        await this.prisma.$transaction(async (tx) => {
            const invoice = await tx.salesInvoice.findUniqueOrThrow({
                where: { id: invoiceId },
                include: {
                    salesOrder: {
                        select: {
                            id: true,
                            orderNo: true,
                            createdById: true,
                            submittedById: true,
                            paymentPlans: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] },
                        },
                    },
                    withdrawalRequest: {
                        select: {
                            id: true,
                            requestNo: true,
                            createdById: true,
                            submittedById: true,
                            salesOrder: {
                                select: {
                                    paymentPlans: {
                                        orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
                                    },
                                },
                            },
                        },
                    },
                },
            })
            if (invoice.status === SalesInvoiceStatus.ISSUED) return

            const issuedAt = new Date()
            await tx.salesInvoice.update({
                where: { id: invoiceId },
                data: {
                    status: SalesInvoiceStatus.ISSUED,
                    // Mã của MISA nếu có; chưa có thì giữ RefID của mình để không mất khóa tra cứu.
                    misaTransactionId: misaResult.misaTransactionId ?? invoice.invoiceNoInternal,
                    misaInvoiceNo: misaResult.invoiceNo ?? null,
                    misaTemplateNo: misaResult.templateNo ?? null,
                    misaSerial: misaResult.serial ?? null,
                    issuedAt,
                    version: { increment: 1 },
                },
            })

            // Mỗi đợt trong lịch thanh toán trở thành một khoản phải thu riêng. Với hóa đơn
            // rút từng phần, tỷ lệ vẫn được áp trên đúng giá trị của hóa đơn lần rút đó.
            await this.accountingInventory.postSalesInvoice(tx, {
                salesInvoiceId: invoiceId,
                actorId: actor.userId,
                effectiveAt: issuedAt,
            })

            const paymentPlans =
                invoice.salesOrder?.paymentPlans ??
                invoice.withdrawalRequest?.salesOrder?.paymentPlans ??
                []
            if (!paymentPlans.length) {
                await this.receivables.openItemForOrder(tx, {
                    salesInvoiceId: invoiceId,
                    installmentNo: 1,
                    amount: invoice.grandTotal,
                    currency: invoice.currency,
                    legalEntityId: invoice.legalEntityId,
                    customerPartyId: invoice.customerPartyId,
                    dueDate: invoice.dueDate,
                    note: `Hóa đơn ${invoice.invoiceNoInternal}`,
                    actorId: actor.userId,
                    effectiveAt: issuedAt,
                })
            } else {
                const amountWeightTotal = paymentPlans.reduce(
                    (sum, plan) => sum.plus(plan.amount ?? 0),
                    new Prisma.Decimal(0),
                )
                let allocated = new Prisma.Decimal(0)
                for (const [index, plan] of paymentPlans.entries()) {
                    const isLast = index === paymentPlans.length - 1
                    const weight = plan.percent
                        ? new Prisma.Decimal(plan.percent).div(100)
                        : new Prisma.Decimal(plan.amount ?? 0).div(amountWeightTotal)
                    const amount = isLast
                        ? new Prisma.Decimal(invoice.grandTotal).minus(allocated)
                        : new Prisma.Decimal(invoice.grandTotal).mul(weight).toDecimalPlaces(2)
                    allocated = allocated.plus(amount)
                    await this.receivables.openItemForOrder(tx, {
                        salesInvoiceId: invoiceId,
                        installmentNo: index + 1,
                        amount,
                        currency: invoice.currency,
                        legalEntityId: invoice.legalEntityId,
                        customerPartyId: invoice.customerPartyId,
                        dueDate: plan.dueDate,
                        note: `Hóa đơn ${invoice.invoiceNoInternal} - đợt ${index + 1}`,
                        actorId: actor.userId,
                        effectiveAt: issuedAt,
                    })
                }
            }

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
            await this.accountingInventory.reverseInvoicePosting(tx, {
                sourceType: 'SALES_INVOICE',
                sourceId: invoiceId,
                actorId: actor.userId,
            })
            const openItems = await tx.receivableOpenItem.findMany({
                where: { salesInvoiceId: invoiceId },
                orderBy: { installmentNo: 'asc' },
            })
            for (const openItem of openItems) {
                if (openItem.status === 'VOIDED') continue
                await tx.receivableLedgerEntry.create({
                    data: {
                        openItemId: openItem.id,
                        type: 'CREDIT_NOTE',
                        amountDelta: openItem.outstandingAmount.negated(),
                        idempotencyKey: `receivable-invoice-cancel:${invoiceId}:${openItem.installmentNo}`,
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
                        // qty/unitPrice để danh sách hiện được cột số lượng và đơn giá
                        // mà không phải mở từng hóa đơn.
                        select: {
                            description: true,
                            qty: true,
                            unitPrice: true,
                            discountAmount: true,
                            taxRate: true,
                            taxRateName: true,
                            netAmount: true,
                            taxAmount: true,
                            lineTotal: true,
                            product: { select: { code: true, name: true } },
                        },
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
        // Dùng cùng mức thuế mặc định với bước preview/createDraft để danh sách
        // "Chưa xuất HĐ" không hiển thị tổng khác với số sắp phát hành.
        const fallbackVat = await this.defaultVat(this.prisma)
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
                        {
                            kind: SalesOrderKind.SINGLE,
                            approvedAt: { not: null },
                            status: {
                                in: [
                                    SalesOrderStatus.RESERVED,
                                    SalesOrderStatus.WAREHOUSE_PROCESSING,
                                    SalesOrderStatus.PARTIALLY_DELIVERED,
                                    SalesOrderStatus.DELIVERED,
                                    SalesOrderStatus.AWAITING_RECONCILIATION,
                                    SalesOrderStatus.AWAITING_INVOICE,
                                ],
                            },
                        },
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
                            vatRate: VAT_RATE_SELECT,
                            product: { select: { code: true } },
                        },
                    },
                },
            }),
            this.prisma.salesLotWithdrawalRequest.findMany({
                where: {
                    status: {
                        in: [
                            SalesWithdrawalStatus.RESERVED,
                            SalesWithdrawalStatus.WAREHOUSE_PROCESSING,
                            SalesWithdrawalStatus.ISSUED,
                        ],
                    },
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
                                select: {
                                    unitPrice: true,
                                    discountAmount: true,
                                    taxRate: true,
                                    vatRate: VAT_RATE_SELECT,
                                },
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
                    vatRate: line.vatRate,
                    productCode: line.product.code,
                })), fallbackVat),
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
                    vatRate: line.orderLine.vatRate,
                    productCode: line.product.code,
                }] : []), fallbackVat),
            })),
        ].sort((a, b) => b.sourceDate.getTime() - a.sourceDate.getTime())

        // Cảnh báo sớm cho kế toán ngay trên danh sách. Đây không thay thế bước
        // confirmCreditRisk lúc phát hành vì số dư có thể thay đổi sau khi tải trang.
        const pageItems = items.slice((page - 1) * limit, page * limit)
        const itemsWithCreditWarnings = await Promise.all(
            pageItems.map(async (item) => {
                const assessment = await this.invoiceCreditAssessment({
                    id: `unissued:${item.id}`,
                    customerPartyId: item.customer.id,
                    documentType: SalesInvoiceDocumentType.ORIGINAL,
                    grandTotal: new Prisma.Decimal(item.estimatedGrandTotal),
                })
                if (!assessment?.riskCodes.length) return item
                return {
                    ...item,
                    creditWarning: {
                        riskCodes: assessment.riskCodes,
                        overdueAmount: assessment.overdueAmount,
                        exceededBy: assessment.exceededBy,
                        actualDebtAfter: assessment.actualDebtAfter,
                        creditLimit: assessment.creditLimit,
                    },
                }
            }),
        )
        return { items: itemsWithCreditWarnings, total: items.length, page, limit }
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
