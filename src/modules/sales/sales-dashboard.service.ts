import { Injectable } from '@nestjs/common'
import {
    Prisma,
    ReceivableOpenItemStatus,
    ReceivableSettlementType,
    SalesApprovalStatus,
    SalesDeliveryStatus,
    SalesInvoiceStatus,
    SalesOrderStatus,
    SalesReconciliationStatus,
    SalesWithdrawalStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

/** Trạng thái đơn còn đang chạy trên chuyền — không tính đơn đã đóng hoặc đã hủy. */
const OPEN_ORDER_STATUSES: SalesOrderStatus[] = [
    SalesOrderStatus.PENDING_REVIEW,
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

const OPEN_RECEIVABLE_STATUSES: ReceivableOpenItemStatus[] = [
    ReceivableOpenItemStatus.OPEN,
    ReceivableOpenItemStatus.PARTIALLY_SETTLED,
]

const num = (value: Prisma.Decimal | number | null | undefined) =>
    value == null ? 0 : Number(value)

type DebtGroup = { customerPartyId: string; _sum: { outstandingAmount: Prisma.Decimal | null } }

/**
 * Số liệu cho màn tổng quan bán hàng. Gom về một lượt gọi để quản lý mở dashboard là
 * thấy đủ ba câu hỏi: bán được bao nhiêu, việc gì đang tắc, tiền về tới đâu.
 */
@Injectable()
export class SalesDashboardService {
    constructor(private readonly prisma: PrismaService) {}

    async get() {
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const tomorrow = new Date(todayStart)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const dueSoonLimit = new Date(todayStart)
        dueSoonLimit.setDate(dueSoonLimit.getDate() + 7)

        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        // Cửa sổ biểu đồ 30 ngày gần nhất, tính cả hôm nay.
        const trendStart = new Date(todayStart)
        trendStart.setDate(trendStart.getDate() - 29)

        const issuedInMonth: Prisma.SalesInvoiceWhereInput = {
            status: SalesInvoiceStatus.ISSUED,
            invoiceDate: { gte: monthStart, lt: nextMonthStart },
        }

        const [
            revenueMonth,
            revenuePrevMonth,
            revenueToday,
            qtyMonth,
            qtyPrevMonth,
            ordersByStatus,
            ordersCreatedMonth,
            approvalsPending,
            withdrawalsNeedSource,
            withdrawalsPendingReview,
            deliveriesReady,
            deliveriesReturned,
            invoicesDraft,
            invoicesPendingIssue,
            invoicesFailed,
            reconciliationOpen,
            receivableOutstanding,
            receivableOverdue,
            receivableDueSoon,
            topDebtors,
            topCustomers,
            topProducts,
            revenueTrend,
            stockByProduct,
        ] = await Promise.all([
            this.prisma.salesInvoice.aggregate({
                where: issuedInMonth,
                _sum: { grandTotal: true },
                _count: { _all: true },
            }),
            this.prisma.salesInvoice.aggregate({
                where: {
                    status: SalesInvoiceStatus.ISSUED,
                    invoiceDate: { gte: prevMonthStart, lt: monthStart },
                },
                _sum: { grandTotal: true },
                _count: { _all: true },
            }),
            this.prisma.salesInvoice.aggregate({
                where: {
                    status: SalesInvoiceStatus.ISSUED,
                    invoiceDate: { gte: todayStart, lt: tomorrow },
                },
                _sum: { grandTotal: true },
                _count: { _all: true },
            }),
            this.prisma.salesDeliveryLine.aggregate({
                where: {
                    postedAt: { gte: monthStart, lt: nextMonthStart },
                    delivery: { status: SalesDeliveryStatus.POSTED },
                },
                _sum: { actualQty: true },
            }),
            this.prisma.salesDeliveryLine.aggregate({
                where: {
                    postedAt: { gte: prevMonthStart, lt: monthStart },
                    delivery: { status: SalesDeliveryStatus.POSTED },
                },
                _sum: { actualQty: true },
            }),
            this.prisma.salesOrder.groupBy({
                by: ['status'],
                where: { status: { not: SalesOrderStatus.CANCELLED } },
                _count: { _all: true },
            }),
            this.prisma.salesOrder.count({
                where: {
                    orderDate: { gte: monthStart, lt: nextMonthStart },
                    status: { not: SalesOrderStatus.CANCELLED },
                },
            }),
            this.prisma.salesApprovalRequest.count({
                where: { status: SalesApprovalStatus.PENDING },
            }),
            this.prisma.salesLotWithdrawalRequest.count({
                where: { status: SalesWithdrawalStatus.NEED_SOURCE },
            }),
            this.prisma.salesLotWithdrawalRequest.count({
                where: { status: SalesWithdrawalStatus.PENDING_REVIEW },
            }),
            this.prisma.salesDelivery.count({ where: { status: SalesDeliveryStatus.READY } }),
            this.prisma.salesDelivery.count({ where: { status: SalesDeliveryStatus.RETURNED } }),
            this.prisma.salesInvoice.count({ where: { status: SalesInvoiceStatus.DRAFT } }),
            this.prisma.salesInvoice.count({ where: { status: SalesInvoiceStatus.PENDING_ISSUE } }),
            this.prisma.salesInvoice.count({ where: { status: SalesInvoiceStatus.ISSUE_FAILED } }),
            this.prisma.salesReconciliation.count({
                where: {
                    status: {
                        in: [SalesReconciliationStatus.OPEN, SalesReconciliationStatus.VARIANCE],
                    },
                },
            }),
            this.prisma.receivableOpenItem.aggregate({
                where: {
                    status: { in: OPEN_RECEIVABLE_STATUSES },
                    settlementType: ReceivableSettlementType.RECEIVABLE,
                },
                _sum: { outstandingAmount: true },
                _count: { _all: true },
            }),
            this.prisma.receivableOpenItem.aggregate({
                where: {
                    status: { in: OPEN_RECEIVABLE_STATUSES },
                    settlementType: ReceivableSettlementType.RECEIVABLE,
                    dueDate: { lt: todayStart },
                },
                _sum: { outstandingAmount: true },
                _count: { _all: true },
            }),
            this.prisma.receivableOpenItem.aggregate({
                where: {
                    status: { in: OPEN_RECEIVABLE_STATUSES },
                    settlementType: ReceivableSettlementType.RECEIVABLE,
                    dueDate: { gte: todayStart, lte: dueSoonLimit },
                },
                _sum: { outstandingAmount: true },
                _count: { _all: true },
            }),
            this.prisma.receivableOpenItem.groupBy({
                by: ['customerPartyId'],
                where: {
                    status: { in: OPEN_RECEIVABLE_STATUSES },
                    settlementType: ReceivableSettlementType.RECEIVABLE,
                },
                _sum: { outstandingAmount: true },
                orderBy: { _sum: { outstandingAmount: 'desc' } },
                take: 6,
            }),
            this.prisma.salesInvoice.groupBy({
                by: ['customerPartyId'],
                where: issuedInMonth,
                _sum: { grandTotal: true },
                _count: { _all: true },
                orderBy: { _sum: { grandTotal: 'desc' } },
                take: 6,
            }),
            this.prisma.salesInvoiceLine.groupBy({
                by: ['productId'],
                where: { invoice: issuedInMonth },
                _sum: { qty: true, netAmount: true },
                orderBy: { _sum: { netAmount: 'desc' } },
                take: 6,
            }),
            this.prisma.salesInvoice.groupBy({
                by: ['invoiceDate'],
                where: {
                    status: SalesInvoiceStatus.ISSUED,
                    invoiceDate: { gte: trendStart, lt: tomorrow },
                },
                _sum: { grandTotal: true },
                orderBy: { invoiceDate: 'asc' },
            }),
            // Chỉ tồn của chính công ty; hàng khách gửi kho không phải hàng để bán.
            this.prisma.inventoryAvailabilityBalance.groupBy({
                by: ['productId'],
                where: { owner: { legalEntities: { some: {} } } },
                _sum: {
                    onHandActualQty: true,
                    reservedActualQty: true,
                    pendingActualQty: true,
                    blockedActualQty: true,
                },
            }),
        ])

        // Giá trị đơn đặt trong tháng phải nhân từng dòng nên không dùng aggregate được.
        const bookedRows = await this.prisma.$queryRaw<{ value: number | null }[]>`
            SELECT COALESCE(
                SUM(line."orderedActualQty" * (line."unitPrice" - line."discountAmount")),
                0
            )::float8 AS value
            FROM "SalesOrderLine" line
            JOIN "SalesOrder" so ON so.id = line."salesOrderId"
            WHERE so."orderDate" >= ${monthStart}
              AND so."orderDate" < ${nextMonthStart}
              AND so.status <> 'CANCELLED'::"SalesOrderStatus"
        `
        const bookedValueMonth = num(bookedRows?.[0]?.value ?? 0)

        const partyIds = Array.from(
            new Set([
                ...topDebtors.map((row: DebtGroup) => row.customerPartyId),
                ...topCustomers.map((row) => row.customerPartyId),
            ]),
        )
        // Có thể bán = tồn thực tế trừ phần đã giữ cho đơn khác, đang chờ chứng từ và bị khóa.
        const stockRows = stockByProduct
            .map((row) => {
                const onHand = num(row._sum.onHandActualQty)
                const reserved = num(row._sum.reservedActualQty)
                const pending = num(row._sum.pendingActualQty)
                const blocked = num(row._sum.blockedActualQty)
                return {
                    productId: row.productId,
                    onHand,
                    reserved,
                    blocked: pending + blocked,
                    sellable: Math.max(onHand - reserved - pending - blocked, 0),
                }
            })
            .filter((row) => row.onHand > 0)
            .sort((a, b) => b.sellable - a.sellable)
            .slice(0, 6)

        const productIds = Array.from(
            new Set([...topProducts.map((row) => row.productId), ...stockRows.map((row) => row.productId)]),
        )

        const [parties, products] = await Promise.all([
            partyIds.length
                ? this.prisma.party.findMany({
                      where: { id: { in: partyIds } },
                      select: { id: true, code: true, name: true },
                  })
                : [],
            productIds.length
                ? this.prisma.product.findMany({
                      where: { id: { in: productIds } },
                      select: { id: true, code: true, name: true, uom: true },
                  })
                : [],
        ])
        const partyById = new Map(parties.map((party) => [party.id, party] as const))
        const productById = new Map(products.map((product) => [product.id, product] as const))

        const byStatus = Object.fromEntries(
            ordersByStatus.map((row) => [row.status, row._count._all]),
        ) as Record<string, number>
        const openOrders = OPEN_ORDER_STATUSES.reduce(
            (total, status) => total + (byStatus[status] ?? 0),
            0,
        )

        return {
            period: {
                today: todayStart.toISOString(),
                monthStart: monthStart.toISOString(),
                month: monthStart.getMonth() + 1,
                year: monthStart.getFullYear(),
            },
            revenue: {
                month: num(revenueMonth._sum.grandTotal),
                monthInvoices: revenueMonth._count._all,
                prevMonth: num(revenuePrevMonth._sum.grandTotal),
                prevMonthInvoices: revenuePrevMonth._count._all,
                today: num(revenueToday._sum.grandTotal),
                todayInvoices: revenueToday._count._all,
                bookedMonth: bookedValueMonth,
                qtyMonth: num(qtyMonth._sum.actualQty),
                qtyPrevMonth: num(qtyPrevMonth._sum.actualQty),
                trend: revenueTrend.map((row) => ({
                    date: row.invoiceDate.toISOString().slice(0, 10),
                    revenue: num(row._sum.grandTotal),
                })),
            },
            pipeline: {
                byStatus,
                openOrders,
                ordersCreatedMonth,
            },
            actions: {
                approvalsPending,
                ordersPendingReview: byStatus[SalesOrderStatus.PENDING_REVIEW] ?? 0,
                withdrawalsNeedSource,
                withdrawalsPendingReview,
                deliveriesReady,
                deliveriesReturned,
                invoicesDraft,
                invoicesPendingIssue,
                invoicesFailed,
                reconciliationOpen,
            },
            receivables: {
                outstanding: num(receivableOutstanding._sum.outstandingAmount),
                outstandingCount: receivableOutstanding._count._all,
                overdue: num(receivableOverdue._sum.outstandingAmount),
                overdueCount: receivableOverdue._count._all,
                dueSoon: num(receivableDueSoon._sum.outstandingAmount),
                dueSoonCount: receivableDueSoon._count._all,
                topDebtors: topDebtors.map((row: DebtGroup) => ({
                    customerPartyId: row.customerPartyId,
                    name: partyById.get(row.customerPartyId)?.name ?? 'Khách hàng',
                    code: partyById.get(row.customerPartyId)?.code ?? null,
                    outstanding: num(row._sum.outstandingAmount),
                })),
            },
            topCustomers: topCustomers.map((row) => ({
                customerPartyId: row.customerPartyId,
                name: partyById.get(row.customerPartyId)?.name ?? 'Khách hàng',
                code: partyById.get(row.customerPartyId)?.code ?? null,
                revenue: num(row._sum.grandTotal),
                invoices: row._count._all,
            })),
            topProducts: topProducts.map((row) => ({
                productId: row.productId,
                name: productById.get(row.productId)?.name ?? 'Mặt hàng',
                code: productById.get(row.productId)?.code ?? null,
                uom: productById.get(row.productId)?.uom ?? null,
                qty: num(row._sum.qty),
                revenue: num(row._sum.netAmount),
            })),
            inventory: {
                sellable: stockRows.reduce((total, row) => total + row.sellable, 0),
                reserved: stockRows.reduce((total, row) => total + row.reserved, 0),
                onHand: stockRows.reduce((total, row) => total + row.onHand, 0),
                items: stockRows.map((row) => ({
                    productId: row.productId,
                    name: productById.get(row.productId)?.name ?? 'Mặt hàng',
                    code: productById.get(row.productId)?.code ?? null,
                    uom: productById.get(row.productId)?.uom ?? null,
                    sellable: row.sellable,
                    reserved: row.reserved,
                    blocked: row.blocked,
                    onHand: row.onHand,
                })),
            },
        }
    }
}
