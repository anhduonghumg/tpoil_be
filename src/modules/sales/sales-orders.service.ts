import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    PurchaseBizType,
    PurchaseOrderType,
    SalesOrderKind,
    SalesOrderStatus,
    SalesOrderSupplySource,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { PURCHASE_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import {
    CreateSalesOrderDto,
    CreateSalesOrderFromPurchaseDto,
    ListSalesOrdersQueryDto,
} from './dto/sales-order.dto'

const detailInclude = Prisma.validator<Prisma.SalesOrderInclude>()({
    customer: { select: { id: true, code: true, name: true, taxCode: true } },
    paymentPlans: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] },
    lines: {
        orderBy: { lineNo: 'asc' },
        include: {
            product: { select: { id: true, code: true, name: true, uom: true } },
            receivingWarehouse: { select: { id: true, code: true, name: true } },
            receivingWarehouseArea: { select: { id: true, code: true, name: true } },
            issueWarehouse: { select: { id: true, code: true, name: true } },
        },
    },
    purchaseOrders: {
        orderBy: { orderDate: 'asc' },
        select: {
            id: true,
            orderNo: true,
            orderDate: true,
            status: true,
            supplier: { select: { id: true, code: true, name: true } },
            lines: {
                orderBy: { lineNo: 'asc' },
                select: {
                    id: true,
                    productId: true,
                    orderedQty: true,
                    actualReceivedQty: true,
                    product: { select: { id: true, code: true, name: true, uom: true } },
                },
            },
        },
    },
    deliveries: {
        select: {
            id: true,
            status: true,
            lines: { select: { actualQty: true } },
        },
    },
    invoices: {
        select: {
            id: true,
            status: true,
            documentType: true,
            lines: { select: { qty: true } },
            receivableItems: {
                select: { originalAmount: true, outstandingAmount: true, status: true, dueDate: true },
            },
        },
    },
    withdrawals: {
        select: {
            id: true,
            status: true,
            deliveries: {
                select: { id: true, status: true, lines: { select: { actualQty: true } } },
            },
            invoices: {
                select: {
                    id: true,
                    status: true,
                    documentType: true,
                    lines: { select: { qty: true } },
                    receivableItems: {
                        select: {
                            originalAmount: true,
                            outstandingAmount: true,
                            status: true,
                            dueDate: true,
                        },
                    },
                },
            },
        },
    },
    warehouseTransfers: {
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            movementNo: true,
            status: true,
            transferReason: true,
            transferFee: true,
            chargeCustomer: true,
            plannedAt: true,
            actualArrivalAt: true,
            fromWarehouse: { select: { id: true, code: true, name: true } },
            toWarehouse: { select: { id: true, code: true, name: true } },
        },
    },
})

@Injectable()
export class SalesOrdersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    private period(date: Date) {
        const year = String(date.getUTCFullYear()).slice(-2)
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        return `${year}${month}`
    }

    async generateOrderNo(customerPartyId: string, orderDate: Date) {
        const customer = await this.prisma.party.findUnique({
            where: { id: customerPartyId },
            select: { code: true },
        })
        if (!customer?.code?.trim()) throw new BadRequestException('CUSTOMER_CODE_REQUIRED')

        const period = this.period(orderDate)
        const sequence = await this.prisma.documentSequence.upsert({
            where: { moduleCode_period: { moduleCode: 'SALES_ORDER', period } },
            create: { moduleCode: 'SALES_ORDER', period, currentNo: 1 },
            update: { currentNo: { increment: 1 } },
        })
        const customerCode = customer.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
        return `BH${period}${String(sequence.currentNo).padStart(4, '0')}${customerCode}`
    }

    /** Quantity ordered by the customer versus quantity actually purchased. */
    private comparison(order: any) {
        const byProduct = new Map<string, { productId: string; product: any; orderedQty: number; purchasedQty: number }>()
        for (const line of order.lines ?? []) {
            const row = byProduct.get(line.productId) ?? {
                productId: line.productId,
                product: line.product,
                orderedQty: 0,
                purchasedQty: 0,
            }
            row.orderedQty += Number(line.orderedActualQty ?? 0)
            byProduct.set(line.productId, row)
        }
        for (const purchase of order.purchaseOrders ?? []) {
            for (const line of purchase.lines ?? []) {
                const row = byProduct.get(line.productId) ?? {
                    productId: line.productId,
                    product: line.product,
                    orderedQty: 0,
                    purchasedQty: 0,
                }
                row.purchasedQty += Number(line.orderedQty ?? 0)
                byProduct.set(line.productId, row)
            }
        }
        return [...byProduct.values()].map((row) => ({
            ...row,
            varianceQty: row.purchasedQty - row.orderedQty,
        }))
    }

    private workflowAxes(order: any) {
        const deliveries = [
            ...(order.deliveries ?? []),
            ...(order.withdrawals ?? []).flatMap((withdrawal: any) => withdrawal.deliveries ?? []),
        ]
        const invoices = [
            ...(order.invoices ?? []),
            ...(order.withdrawals ?? []).flatMap((withdrawal: any) => withdrawal.invoices ?? []),
        ]
        const effectiveInvoices = invoices.filter(
            (invoice: any) => invoice.status !== 'CANCELLED' && invoice.documentType === 'ORIGINAL',
        )
        const issuedInvoices = effectiveInvoices.filter((invoice: any) => invoice.status === 'ISSUED')
        const totalQty = (order.lines ?? []).reduce(
            (sum: Prisma.Decimal, line: any) => sum.plus(line.orderedActualQty ?? 0),
            new Prisma.Decimal(0),
        )
        const issuedQty = deliveries
            .filter((delivery: any) => delivery.status === 'POSTED')
            .flatMap((delivery: any) => delivery.lines ?? [])
            .reduce(
                (sum: Prisma.Decimal, line: any) => sum.plus(line.actualQty ?? 0),
                new Prisma.Decimal(0),
            )
        const invoicedQty = issuedInvoices
            .flatMap((invoice: any) => invoice.lines ?? [])
            .reduce(
                (sum: Prisma.Decimal, line: any) => sum.plus(line.qty ?? 0),
                new Prisma.Decimal(0),
            )

        const approval =
            order.status === 'CANCELLED'
                ? 'CANCELLED'
                : order.status === 'REJECTED'
                  ? 'REJECTED'
                  : order.approvedAt
                    ? 'APPROVED'
                    : order.status === 'PENDING_REVIEW'
                      ? 'PENDING'
                      : 'DRAFT'
        const warehouse =
            order.status === 'CANCELLED'
                ? 'CANCELLED'
                : issuedQty.greaterThanOrEqualTo(totalQty) && totalQty.greaterThan(0)
                  ? 'ISSUED'
                  : issuedQty.greaterThan(0)
                    ? 'PARTIALLY_ISSUED'
                    : deliveries.some((delivery: any) => ['DRAFT', 'READY', 'RETURNED'].includes(delivery.status))
                      ? 'PROCESSING'
                      : order.approvedAt
                        ? 'READY'
                        : 'NOT_STARTED'
        const invoicing =
            issuedInvoices.length && invoicedQty.greaterThanOrEqualTo(totalQty) && totalQty.greaterThan(0)
                ? 'INVOICED'
                : issuedInvoices.length
                  ? 'PARTIALLY_INVOICED'
                  : effectiveInvoices.some((invoice: any) => invoice.status === 'ISSUE_FAILED')
                    ? 'ISSUE_FAILED'
                    : effectiveInvoices.length
                      ? 'DRAFT'
                      : invoices.length
                        ? 'CANCELLED'
                        : 'NOT_INVOICED'

        const openItems = issuedInvoices.flatMap((invoice: any) => invoice.receivableItems ?? [])
        const originalReceivable = openItems.reduce(
            (sum: Prisma.Decimal, item: any) => sum.plus(item.originalAmount ?? 0),
            new Prisma.Decimal(0),
        )
        const outstandingReceivable = openItems.reduce(
            (sum: Prisma.Decimal, item: any) => sum.plus(item.outstandingAmount ?? 0),
            new Prisma.Decimal(0),
        )
        const receivable = !openItems.length
            ? 'NOT_OPEN'
            : outstandingReceivable.lessThanOrEqualTo(0)
              ? 'SETTLED'
              : outstandingReceivable.lessThan(originalReceivable)
                ? 'PARTIALLY_SETTLED'
                : 'OPEN'

        return {
            approval,
            warehouse,
            invoicing,
            receivable,
            totalQty: totalQty.toString(),
            issuedQty: issuedQty.toString(),
            invoicedQty: invoicedQty.toString(),
            receivableAmount: originalReceivable.toString(),
            outstandingAmount: outstandingReceivable.toString(),
            canCancelOrder: issuedQty.isZero() && effectiveInvoices.length === 0,
        }
    }

    private mapOrder(order: any) {
        return { ...order, comparison: this.comparison(order), workflow: this.workflowAxes(order) }
    }

    async list(query: ListSalesOrdersQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const keyword = query.keyword?.trim()
        // Một tab có thể gom nhiều trạng thái ("đơn đã duyệt"), nên `status` nhận danh
        // sách ngăn bởi dấu phẩy. Tab nhập nhanh chỉ là tên trên giao diện: giá trị nào
        // không phải trạng thái thật thì bỏ qua thay vì đẩy xuống Prisma.
        const statuses = (query.status ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter((value): value is SalesOrderStatus =>
                Object.values(SalesOrderStatus).includes(value as SalesOrderStatus),
            )
        const where: Prisma.SalesOrderWhereInput = {
            customerPartyId: query.customerPartyId ?? undefined,
            kind: query.kind ? (query.kind as SalesOrderKind) : undefined,
            status: statuses.length === 0 ? undefined : statuses.length === 1 ? statuses[0] : { in: statuses },
            ...(keyword
                ? {
                      OR: [
                          { orderNo: { contains: keyword, mode: 'insensitive' } },
                          { customer: { name: { contains: keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }

        const [rows, total] = await this.prisma.$transaction([
            this.prisma.salesOrder.findMany({
                where,
                include: detailInclude,
                orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.salesOrder.count({ where }),
        ])
        return { items: rows.map((row) => this.mapOrder(row)), total, page, limit }
    }

    /**
     * Counts per status for the tab strip. Deliberately ignores the status filter so a
     * tab still shows how many orders it holds while another tab is open.
     */
    async statusCounts(query: ListSalesOrdersQueryDto) {
        const keyword = query.keyword?.trim()
        const where: Prisma.SalesOrderWhereInput = {
            customerPartyId: query.customerPartyId ?? undefined,
            kind: query.kind ? (query.kind as SalesOrderKind) : undefined,
            ...(keyword
                ? {
                      OR: [
                          { orderNo: { contains: keyword, mode: 'insensitive' } },
                          { customer: { name: { contains: keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }

        const grouped = await this.prisma.salesOrder.groupBy({
            by: ['status'],
            where,
            _count: { _all: true },
        })

        const byStatus: Record<string, number> = {}
        let total = 0
        for (const row of grouped) {
            byStatus[row.status] = row._count._all
            total += row._count._all
        }
        return { byStatus, total }
    }

    async detail(id: string) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: detailInclude,
        })
        if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
        return this.mapOrder(order)
    }

    /**
     * DAY_TRADE only (legacy buy-to-order flow): sales records what the customer ordered
     * and hands it to purchasing, who then buys the goods from a supplier.
     * SINGLE/LOT orders are created by SalesOrderWorkflowService instead.
     */
    async create(dto: CreateSalesOrderDto, actorId?: string | null) {
        const customer = await this.prisma.party.findUnique({
            where: { id: dto.customerPartyId },
            select: { id: true, name: true },
        })
        if (!customer) throw new BadRequestException('CUSTOMER_NOT_FOUND')

        const legalEntity = await this.prisma.legalEntity.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true, baseCurrency: true },
        })
        if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_NOT_FOUND')

        const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date()
        if (Number.isNaN(orderDate.getTime())) throw new BadRequestException('ORDER_DATE_INVALID')

        const orderNo = await this.generateOrderNo(dto.customerPartyId, orderDate)

        const created = await this.prisma.$transaction(async (tx) => {
            const salesOrder = await tx.salesOrder.create({
                data: {
                    legalEntityId: legalEntity.id,
                    orderNo,
                    customerPartyId: dto.customerPartyId,
                    kind: SalesOrderKind.DAY_TRADE,
                    status: SalesOrderStatus.DRAFT,
                    orderDate,
                    currency: legalEntity.baseCurrency || 'VND',
                    note: dto.note?.trim() || null,
                    createdById: actorId ?? null,
                    lines: {
                        create: dto.lines.map((line, index) => {
                            const discountBaseAmount = new Prisma.Decimal(
                                line.discountBaseAmount ?? line.discountAmount ?? 0,
                            )
                            const discountAdjustmentAmount = new Prisma.Decimal(
                                line.discountAdjustmentAmount ?? 0,
                            )
                            const discountAmount = discountBaseAmount.plus(discountAdjustmentAmount)
                            if (discountAmount.lessThan(0)) {
                                throw new BadRequestException('SALES_ORDER_FINAL_DISCOUNT_NEGATIVE')
                            }
                            return {
                                lineNo: index + 1,
                                productId: line.productId,
                                receivingWarehouseId: line.receivingWarehouseId ?? null,
                                orderedActualQty: new Prisma.Decimal(line.orderedActualQty),
                                orderedV15Qty:
                                    line.orderedV15Qty == null
                                        ? null
                                        : new Prisma.Decimal(line.orderedV15Qty),
                                unitPrice: new Prisma.Decimal(line.unitPrice ?? 0),
                                discountBaseAmount,
                                discountAdjustmentAmount,
                                discountAmount,
                                supplySource: line.supplySource ?? SalesOrderSupplySource.TP,
                                vehiclePlate: line.vehiclePlate?.trim() || null,
                                driverName: line.driverName?.trim() || null,
                                taxRate: line.taxRate == null ? null : new Prisma.Decimal(line.taxRate),
                                vatRateId: line.vatRateId ?? null,
                                note: line.note?.trim() || null,
                            }
                        }),
                    },
                },
                select: { id: true, orderNo: true },
            })

            await this.notificationOutbox.emit(
                {
                    eventType: PURCHASE_NOTIFICATION_EVENTS.SALES_ORDER_REQUESTED,
                    aggregateType: 'SALES_ORDER',
                    aggregateId: salesOrder.id,
                    dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.SALES_ORDER_REQUESTED}:${salesOrder.id}`,
                    payload: {
                        entityType: 'SALES_ORDER',
                        entityId: salesOrder.id,
                        workItemSourceType: 'SALES_ORDER',
                        workItemSourceId: salesOrder.id,
                        orderNo: salesOrder.orderNo,
                        customerName: customer.name,
                        actionRequired: true,
                        // No actor exclusion: this is purchasing's work queue, so whoever
                        // holds the purchasing role must get the task even if they typed
                        // the order in themselves.
                        recipientPermissionPrefixes: ['purchases.'],
                    },
                },
                tx,
            )
            return salesOrder
        })

        return this.detail(created.id)
    }

    async createFromPurchaseOrder(purchaseOrderId: string, dto: CreateSalesOrderFromPurchaseDto) {
        const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
            where: {
                id: purchaseOrderId,
                orderType: PurchaseOrderType.SINGLE,
                bizType: PurchaseBizType.COMMERCIAL,
            },
            include: { lines: { orderBy: { lineNo: 'asc' } } },
        })
        if (!purchaseOrder) throw new NotFoundException('RETAIL_PURCHASE_ORDER_NOT_FOUND')
        if (purchaseOrder.salesOrderId) {
            throw new BadRequestException({
                code: 'PURCHASE_ORDER_ALREADY_LINKED',
                message: 'Đơn mua này đã gắn với một đơn đặt hàng kinh doanh.',
            })
        }

        const customer = await this.prisma.party.findUnique({
            where: { id: dto.customerPartyId },
            select: { id: true },
        })
        if (!customer) throw new BadRequestException('CUSTOMER_NOT_FOUND')

        const orderDate = dto.orderDate ? new Date(dto.orderDate) : purchaseOrder.orderDate
        if (Number.isNaN(orderDate.getTime())) throw new BadRequestException('ORDER_DATE_INVALID')

        const sourceLines = dto.lines?.length
            ? dto.lines.map((line) => ({
                  productId: line.productId,
                  orderedActualQty: new Prisma.Decimal(line.orderedActualQty),
                  orderedV15Qty:
                      line.orderedV15Qty == null ? null : new Prisma.Decimal(line.orderedV15Qty),
                  unitPrice: new Prisma.Decimal(line.unitPrice ?? 0),
                  taxRate: line.taxRate == null ? null : new Prisma.Decimal(line.taxRate),
                  vatRateId: line.vatRateId ?? null,
                  note: line.note?.trim() || null,
              }))
            : purchaseOrder.lines.map((line) => ({
                  productId: line.productId,
                  orderedActualQty: line.orderedQty,
                  orderedV15Qty: null,
                  // Selling price belongs to sales; purchasing only records what was ordered.
                  unitPrice: new Prisma.Decimal(0),
                  taxRate: line.taxRate,
                  // Đơn mua không gắn dòng thuế của bán; để trống, kế toán chọn khi sửa đơn.
                  vatRateId: null,
                  note: null,
              }))
        if (!sourceLines.length) throw new BadRequestException('SALES_ORDER_LINES_REQUIRED')

        const orderNo = await this.generateOrderNo(dto.customerPartyId, orderDate)

        const created = await this.prisma.$transaction(async (tx) => {
            const salesOrder = await tx.salesOrder.create({
                data: {
                    legalEntityId: purchaseOrder.legalEntityId,
                    orderNo,
                    customerPartyId: dto.customerPartyId,
                    kind: SalesOrderKind.DAY_TRADE,
                    status: SalesOrderStatus.DRAFT,
                    orderDate,
                    currency: purchaseOrder.currency,
                    note: dto.note?.trim() || null,
                    lines: {
                        create: sourceLines.map((line, index) => ({
                            lineNo: index + 1,
                            productId: line.productId,
                            orderedActualQty: line.orderedActualQty,
                            orderedV15Qty: line.orderedV15Qty,
                            unitPrice: line.unitPrice,
                            taxRate: line.taxRate,
                            vatRateId: line.vatRateId,
                            note: line.note,
                        })),
                    },
                },
                select: { id: true },
            })
            await tx.purchaseOrder.update({
                where: { id: purchaseOrder.id },
                data: { salesOrderId: salesOrder.id, version: { increment: 1 } },
            })
            return salesOrder
        })

        return this.detail(created.id)
    }

    /** Purchasing bought against an existing customer order: tie the two together. */
    async attachPurchaseOrder(salesOrderId: string, purchaseOrderId: string) {
        const salesOrder = await this.prisma.salesOrder.findUnique({
            where: { id: salesOrderId },
            select: { id: true, kind: true },
        })
        if (!salesOrder) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
        if (salesOrder.kind !== SalesOrderKind.DAY_TRADE) {
            throw new BadRequestException({
                code: 'SALES_ORDER_NOT_DAY_TRADE',
                message: 'Chỉ đơn mua bán trong ngày mới gắn được với đơn mua lẻ.',
            })
        }

        const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
            where: {
                id: purchaseOrderId,
                orderType: PurchaseOrderType.SINGLE,
                bizType: PurchaseBizType.COMMERCIAL,
            },
            select: { id: true, salesOrderId: true },
        })
        if (!purchaseOrder) throw new NotFoundException('RETAIL_PURCHASE_ORDER_NOT_FOUND')
        if (purchaseOrder.salesOrderId && purchaseOrder.salesOrderId !== salesOrderId) {
            throw new BadRequestException({
                code: 'PURCHASE_ORDER_ALREADY_LINKED',
                message: 'Đơn mua này đã gắn với một đơn đặt hàng khác.',
            })
        }

        await this.prisma.purchaseOrder.update({
            where: { id: purchaseOrder.id },
            data: { salesOrderId, version: { increment: 1 } },
        })
        return this.detail(salesOrderId)
    }

    async unlinkPurchaseOrder(purchaseOrderId: string) {
        const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            select: { id: true, salesOrderId: true },
        })
        if (!purchaseOrder?.salesOrderId) throw new BadRequestException('PURCHASE_ORDER_NOT_LINKED')
        await this.prisma.purchaseOrder.update({
            where: { id: purchaseOrder.id },
            data: { salesOrderId: null, version: { increment: 1 } },
        })
        return { success: true }
    }
}
