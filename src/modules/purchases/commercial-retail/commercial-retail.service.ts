import { Injectable, NotFoundException } from '@nestjs/common'
import {
    GoodsReceiptStatus,
    PayableOpenItemStatus,
    Prisma,
    PurchaseBizType,
    PurchaseOrderStatus,
    PurchaseOrderType,
    SupplierInvoiceStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ListCommercialRetailQueryDto } from './dto/commercial-retail.dto'

const detailInclude = Prisma.validator<Prisma.PurchaseOrderInclude>()({
    supplier: { select: { id: true, code: true, name: true, taxCode: true, bankAccountNo: true } },
    contract: { select: { id: true, code: true, name: true, startDate: true, endDate: true } },
    lines: {
        orderBy: { lineNo: 'asc' },
        include: {
            product: { select: { id: true, code: true, name: true, uom: true } },
            receivingWarehouse: { select: { id: true, code: true, name: true } },
        },
    },
    supplierInvoices: {
        where: { status: { not: SupplierInvoiceStatus.VOIDED } },
        orderBy: { invoiceDate: 'asc' },
        include: {
            openItem: true,
            lines: {
                select: {
                    id: true,
                    purchaseOrderLineId: true,
                    actualQty: true,
                    netAmount: true,
                    taxAmount: true,
                },
            },
        },
    },
    termPaymentRequests: {
        orderBy: { createdAt: 'desc' },
        include: {
            supplierInvoice: { select: { id: true, invoiceNo: true, invoiceDate: true } },
            payments: {
                orderBy: { paidAt: 'desc' },
                include: {
                    sourceBankAccount: {
                        select: { id: true, bankCode: true, bankName: true, accountNo: true },
                    },
                },
            },
        },
    },
    receipts: {
        orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
        include: {
            warehouse: { select: { id: true, code: true, name: true } },
            lines: {
                orderBy: { lineNo: 'asc' },
                include: { product: { select: { id: true, code: true, name: true, uom: true } } },
            },
        },
    },
    salesOrder: {
        select: {
            id: true,
            orderNo: true,
            orderDate: true,
            status: true,
            note: true,
            customer: { select: { id: true, code: true, name: true } },
            lines: {
                orderBy: { lineNo: 'asc' },
                select: {
                    id: true,
                    productId: true,
                    orderedActualQty: true,
                    unitPrice: true,
                    discountAmount: true,
                    vehiclePlate: true,
                    driverName: true,
                    product: { select: { id: true, code: true, name: true, uom: true } },
                    receivingWarehouse: { select: { id: true, code: true, name: true } },
                },
            },
        },
    },
})

@Injectable()
export class CommercialRetailService {
    constructor(private readonly prisma: PrismaService) {}

    private quantityTotals(order: any) {
        const orderedQty = (order.lines ?? []).reduce(
            (sum: number, line: any) => sum + Number(line.orderedQty ?? 0),
            0,
        )
        const invoicedQty = (order.supplierInvoices ?? [])
            .filter((invoice: any) => invoice.status === SupplierInvoiceStatus.POSTED)
            .reduce(
                (sum: number, invoice: any) =>
                    sum +
                    (invoice.lines ?? []).reduce(
                        (lineSum: number, line: any) => lineSum + Number(line.actualQty ?? 0),
                        0,
                    ),
                0,
            )
        const receivedQty = (order.receipts ?? [])
            .filter((receipt: any) => receipt.status === GoodsReceiptStatus.CONFIRMED)
            .reduce(
                (sum: number, receipt: any) =>
                    sum +
                    (receipt.lines ?? []).reduce(
                        (lineSum: number, line: any) => lineSum + Number(line.actualQty ?? 0),
                        0,
                    ),
                0,
            )
        return {
            orderedQty,
            invoicedQty,
            receivedQty,
            remainingToReceive: Math.max(orderedQty - receivedQty, 0),
        }
    }

    private paymentTotals(order: any) {
        const postedInvoices = (order.supplierInvoices ?? []).filter(
            (invoice: any) => invoice.status === SupplierInvoiceStatus.POSTED,
        )
        const payableAmount = postedInvoices.reduce(
            (sum: number, invoice: any) =>
                sum + Number(invoice.openItem?.originalAmount ?? invoice.totalAmount ?? 0),
            0,
        )
        const outstandingAmount = postedInvoices.reduce(
            (sum: number, invoice: any) =>
                sum + Number(invoice.openItem?.outstandingAmount ?? invoice.totalAmount ?? 0),
            0,
        )
        return {
            payableAmount,
            paidAmount: Math.max(payableAmount - outstandingAmount, 0),
            outstandingAmount,
            isPaid:
                postedInvoices.length > 0 &&
                postedInvoices.every(
                    (invoice: any) => invoice.openItem?.status === PayableOpenItemStatus.SETTLED,
                ),
        }
    }

    /**
     * Same shape as the lot lifecycle so both screens can share their look; the two
     * withdrawal steps become warehouse receipt steps.
     */
    private lifecycle(order: any) {
        if (order.status === PurchaseOrderStatus.CANCELLED) return 'CANCELLED'
        if (order.status === PurchaseOrderStatus.DRAFT) return 'PENDING_APPROVAL'

        const postedInvoices = (order.supplierInvoices ?? []).filter(
            (invoice: any) => invoice.status === SupplierInvoiceStatus.POSTED,
        )
        if (!postedInvoices.length) return 'PENDING_INVOICE'
        if (!this.paymentTotals(order).isPaid) return 'PENDING_PAYMENT'

        const totals = this.quantityTotals(order)
        if (totals.receivedQty > 0 && totals.remainingToReceive <= 0) return 'COMPLETED'
        if (totals.receivedQty > 0) return 'RECEIVING'
        return 'READY_TO_RECEIVE'
    }

    /** Revenue from the customer order versus cost of the purchase order, excluding VAT. */
    private profitAndLoss(order: any) {
        const rows = new Map<
            string,
            {
                productId: string
                product: any
                orderedQty: number
                purchasedQty: number
                revenue: number
                cost: number
            }
        >()

        const rowFor = (productId: string, product: any) => {
            const existing = rows.get(productId)
            if (existing) return existing
            const created = {
                productId,
                product,
                orderedQty: 0,
                purchasedQty: 0,
                revenue: 0,
                cost: 0,
            }
            rows.set(productId, created)
            return created
        }

        for (const line of order.salesOrder?.lines ?? []) {
            const row = rowFor(line.productId, line.product)
            const qty = Number(line.orderedActualQty ?? 0)
            row.orderedQty += qty
            row.revenue +=
                qty * Math.max(Number(line.unitPrice ?? 0) - Number(line.discountAmount ?? 0), 0)
        }

        for (const line of order.lines ?? []) {
            const row = rowFor(line.productId, line.product)
            const qty = Number(line.orderedQty ?? 0)
            row.purchasedQty += qty
            row.cost +=
                qty * Math.max(Number(line.unitPrice ?? 0) - Number(line.discountAmount ?? 0), 0)
        }

        const items = [...rows.values()].map((row) => ({
            ...row,
            varianceQty: row.purchasedQty - row.orderedQty,
            profit: row.revenue - row.cost,
        }))
        const revenue = items.reduce((sum, row) => sum + row.revenue, 0)
        const cost = items.reduce((sum, row) => sum + row.cost, 0)
        const profit = revenue - cost

        return {
            items,
            revenue,
            cost,
            profit,
            marginPercent: revenue > 0 ? (profit / revenue) * 100 : 0,
            hasSalesOrder: Boolean(order.salesOrder),
        }
    }

    /** Order value excluding VAT, so the list can show something meaningful. */
    private orderValue(order: any) {
        return (order.lines ?? []).reduce(
            (sum: number, line: any) =>
                sum +
                Number(line.orderedQty ?? 0) *
                    Math.max(Number(line.unitPrice ?? 0) - Number(line.discountAmount ?? 0), 0),
            0,
        )
    }

    private mapOrder(order: any) {
        return {
            ...order,
            lifecycle: this.lifecycle(order),
            quantities: this.quantityTotals(order),
            payment: this.paymentTotals(order),
            orderValue: this.orderValue(order),
        }
    }

    async list(query: ListCommercialRetailQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const keyword = query.keyword?.trim()
        const where: Prisma.PurchaseOrderWhereInput = {
            orderType: PurchaseOrderType.SINGLE,
            bizType: PurchaseBizType.COMMERCIAL,
            supplierCustomerId: query.supplierCustomerId ?? undefined,
            orderDate: {
                gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
                lte: query.dateTo ? new Date(`${query.dateTo}T23:59:59.999Z`) : undefined,
            },
            ...(keyword
                ? {
                      OR: [
                          { orderNo: { contains: keyword, mode: 'insensitive' } },
                          { supplier: { name: { contains: keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }

        // Lifecycle is derived, not stored, so it has to be filtered after mapping.
        if (query.lifecycle) {
            const rows = await this.prisma.purchaseOrder.findMany({
                where,
                include: detailInclude,
                orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
                take: 1000,
            })
            const matching = rows
                .map((row) => this.mapOrder(row))
                .filter((item) => item.lifecycle === query.lifecycle)
            return {
                items: matching.slice((page - 1) * limit, page * limit),
                total: matching.length,
                page,
                limit,
            }
        }

        const [rows, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                include: detailInclude,
                orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.purchaseOrder.count({ where }),
        ])
        return { items: rows.map((row) => this.mapOrder(row)), total, page, limit }
    }

    async detail(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: {
                id,
                orderType: PurchaseOrderType.SINGLE,
                bizType: PurchaseBizType.COMMERCIAL,
            },
            include: detailInclude,
        })
        if (!order) throw new NotFoundException('COMMERCIAL_RETAIL_PURCHASE_NOT_FOUND')

        return {
            ...order,
            lifecycle: this.lifecycle(order),
            quantities: this.quantityTotals(order),
            payment: this.paymentTotals(order),
            profitAndLoss: this.profitAndLoss(order),
        }
    }
}
