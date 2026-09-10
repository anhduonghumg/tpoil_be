import { Injectable } from '@nestjs/common'
import {
    CostLayerEntryType,
    Prisma,
    SalesDeliveryStatus,
    SalesInvoiceStatus,
    SalesOrderKind,
    SalesOrderStatus,
    SalesWithdrawalStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SalesManagementReportQueryDto } from './dto/sales-management-report.dto'
import { salesLineNetUnitPrice } from './sales-order-amount'

const REPORTABLE_ORDER_STATUSES: SalesOrderStatus[] = [
    SalesOrderStatus.CONFIRMED,
    SalesOrderStatus.AWAITING_STOCK,
    SalesOrderStatus.PARTIALLY_RESERVED,
    SalesOrderStatus.RESERVED,
    SalesOrderStatus.WAREHOUSE_PROCESSING,
    SalesOrderStatus.PARTIALLY_DELIVERED,
    SalesOrderStatus.DELIVERED,
    SalesOrderStatus.AWAITING_RECONCILIATION,
    SalesOrderStatus.AWAITING_INVOICE,
    SalesOrderStatus.COMPLETED,
]

const ACTIVE_WITHDRAWAL_STATUSES: SalesWithdrawalStatus[] = [
    SalesWithdrawalStatus.APPROVED,
    SalesWithdrawalStatus.RESERVED,
    SalesWithdrawalStatus.WAREHOUSE_PROCESSING,
]

type CostStatus = 'FINAL' | 'PROVISIONAL' | 'NO_COST_BASIS'

@Injectable()
export class SalesManagementReportService {
    constructor(private readonly prisma: PrismaService) {}

    private decimal(value: Prisma.Decimal | string | number | null | undefined) {
        return new Prisma.Decimal(value ?? 0)
    }

    private period(query: SalesManagementReportQueryDto) {
        const now = new Date()
        const from = query.dateFrom
            ? new Date(query.dateFrom)
            : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        const to = query.dateTo
            ? new Date(query.dateTo)
            : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
        from.setUTCHours(0, 0, 0, 0)
        to.setUTCHours(23, 59, 59, 999)
        return { from, to }
    }

    async get(query: SalesManagementReportQueryDto) {
        const { from, to } = this.period(query)
        const keyword = query.keyword?.trim()
        const dateFilter = { gte: from, lte: to }
        const andFilters: Prisma.SalesOrderWhereInput[] = []

        if (query.warehouseId) {
            andFilters.push({
                OR: [
                    { lines: { some: { issueWarehouseId: query.warehouseId } } },
                    { withdrawals: { some: { lines: { some: { warehouseId: query.warehouseId } } } } },
                ],
            })
        }
        if (query.areaId) {
            andFilters.push({
                OR: [
                    { lines: { some: { receivingWarehouseAreaId: query.areaId } } },
                    { lines: { some: { issueWarehouse: { areaId: query.areaId } } } },
                    {
                        withdrawals: {
                            some: {
                                lines: { some: { warehouse: { areaId: query.areaId } } },
                            },
                        },
                    },
                ],
            })
        }
        if (keyword) {
            andFilters.push({
                OR: [
                    { orderNo: { contains: keyword, mode: 'insensitive' } },
                    { customer: { code: { contains: keyword, mode: 'insensitive' } } },
                    { customer: { name: { contains: keyword, mode: 'insensitive' } } },
                ],
            })
        }

        const where: Prisma.SalesOrderWhereInput = {
            status: { in: REPORTABLE_ORDER_STATUSES },
            ...(query.dateBasis === 'DELIVERY_DATE'
                ? { deliveries: { some: { status: SalesDeliveryStatus.POSTED, deliveredAt: dateFilter } } }
                : { orderDate: dateFilter }),
            ...(query.customerPartyId ? { customerPartyId: query.customerPartyId } : {}),
            ...(query.salesOwnerEmpId ? { salesOwnerEmpId: query.salesOwnerEmpId } : {}),
            ...(query.kind ? { kind: query.kind as SalesOrderKind } : {}),
            ...(query.productId ? { lines: { some: { productId: query.productId } } } : {}),
            ...(andFilters.length ? { AND: andFilters } : {}),
        }

        const orders = await this.prisma.salesOrder.findMany({
            where,
            orderBy: [{ orderDate: 'desc' }, { orderNo: 'desc' }],
            include: {
                customer: { select: { id: true, code: true, name: true } },
                salesOwner: { select: { id: true, code: true, fullName: true } },
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        lotPosition: { select: { totalQty: true, issuedQty: true, adjustedQty: true } },
                        receivingWarehouseArea: { select: { id: true, name: true } },
                        issueWarehouse: {
                            select: { id: true, code: true, name: true, area: { select: { id: true, name: true } } },
                        },
                    },
                },
                deliveries: {
                    where: { status: SalesDeliveryStatus.POSTED },
                    include: {
                        warehouse: { select: { id: true, code: true, name: true } },
                        lines: {
                            include: {
                                orderLine: { select: { unitPrice: true, discountAmount: true, transportFeeUnitPrice: true } },
                                invoiceLines: {
                                    where: { invoice: { status: SalesInvoiceStatus.ISSUED } },
                                    select: { qty: true, netAmount: true },
                                },
                                costEntries: {
                                    where: {
                                        type: { in: [CostLayerEntryType.SALES_ISSUE, CostLayerEntryType.REVALUATION] },
                                        reversedBy: null,
                                    },
                                    select: {
                                        valueDelta: true,
                                        costLayer: { select: { isProvisional: true } },
                                    },
                                },
                            },
                        },
                    },
                },
                withdrawals: {
                    orderBy: [{ requestDate: 'asc' }, { requestNo: 'asc' }],
                    include: {
                        lines: {
                            include: {
                                warehouse: { select: { id: true, code: true, name: true } },
                                product: { select: { id: true, code: true, name: true } },
                            },
                        },
                        deliveries: {
                            where: { status: SalesDeliveryStatus.POSTED },
                            select: {
                                lines: { select: { actualQty: true } },
                            },
                        },
                    },
                },
            },
        })

        let rows = orders.map((order) => {
            let orderedQty = new Prisma.Decimal(0)
            let remainingQty = new Prisma.Decimal(0)
            let projectedRevenue = new Prisma.Decimal(0)
            for (const line of order.lines) {
                const qty = this.decimal(line.orderedActualQty)
                orderedQty = orderedQty.plus(qty)
                const remaining = order.kind === SalesOrderKind.LOT && line.lotPosition
                    ? this.decimal(line.lotPosition.totalQty)
                          .minus(line.lotPosition.issuedQty)
                          .minus(line.lotPosition.adjustedQty)
                    : qty
                remainingQty = remainingQty.plus(Prisma.Decimal.max(remaining, 0))
                projectedRevenue = projectedRevenue.plus(
                    Prisma.Decimal.max(remaining, 0).mul(salesLineNetUnitPrice(line)),
                )
            }

            let deliveredQty = new Prisma.Decimal(0)
            let totalDeliveredQty = new Prisma.Decimal(0)
            let revenue = new Prisma.Decimal(0)
            let cost = new Prisma.Decimal(0)
            let provisional = false
            let costEntries = 0
            for (const delivery of order.deliveries) {
                for (const line of delivery.lines) {
                    const actualQty = this.decimal(line.actualQty)
                    totalDeliveredQty = totalDeliveredQty.plus(actualQty)
                    const deliveryTime = delivery.deliveredAt?.getTime() ?? 0
                    const inSelectedPeriod =
                        query.dateBasis !== 'DELIVERY_DATE' ||
                        (deliveryTime >= from.getTime() && deliveryTime <= to.getTime())
                    if (!inSelectedPeriod) continue
                    deliveredQty = deliveredQty.plus(actualQty)
                    const invoicedQty = line.invoiceLines.reduce(
                        (sum, row) => sum.plus(row.qty),
                        new Prisma.Decimal(0),
                    )
                    const invoicedRevenue = line.invoiceLines.reduce(
                        (sum, row) => sum.plus(row.netAmount),
                        new Prisma.Decimal(0),
                    )
                    const uninvoicedQty = Prisma.Decimal.max(actualQty.minus(invoicedQty), 0)
                    revenue = revenue
                        .plus(invoicedRevenue)
                        .plus(
                            uninvoicedQty.mul(salesLineNetUnitPrice(line.orderLine)),
                        )
                    for (const entry of line.costEntries) {
                        costEntries += 1
                        cost = cost.minus(entry.valueDelta)
                        provisional ||= entry.costLayer.isProvisional
                    }
                }
            }
            if (order.kind !== SalesOrderKind.LOT) {
                remainingQty = Prisma.Decimal.max(orderedQty.minus(totalDeliveredQty), 0)
                projectedRevenue = order.lines.reduce((sum, line) => {
                    const lineDelivered = order.deliveries
                        .flatMap((delivery) => delivery.lines)
                        .filter((row) => row.salesOrderLineId === line.id)
                        .reduce((qty, row) => qty.plus(this.decimal(row.actualQty)), new Prisma.Decimal(0))
                    return sum.plus(
                        Prisma.Decimal.max(this.decimal(line.orderedActualQty).minus(lineDelivered), 0).mul(
                            salesLineNetUnitPrice(line),
                        ),
                    )
                }, new Prisma.Decimal(0))
            }

            const processingQty = order.withdrawals
                .filter((request) => ACTIVE_WITHDRAWAL_STATUSES.includes(request.status))
                .flatMap((request) => request.lines)
                .reduce((sum, line) => sum.plus(line.requestedQty), new Prisma.Decimal(0))
            const profit = revenue.minus(cost)
            const costStatus: CostStatus = deliveredQty.greaterThan(0) && costEntries === 0
                ? 'NO_COST_BASIS'
                : provisional
                  ? 'PROVISIONAL'
                  : 'FINAL'
            const withdrawals = order.withdrawals
                .filter(
                    (request) =>
                        request.status !== SalesWithdrawalStatus.REJECTED &&
                        request.status !== SalesWithdrawalStatus.CANCELLED,
                )
                .map((request) => ({
                    id: request.id,
                    requestNo: request.requestNo,
                    requestDate: request.requestDate,
                    status: request.status,
                    requestedQty: request.lines
                        .reduce((sum, line) => sum.plus(line.requestedQty), new Prisma.Decimal(0))
                        .toNumber(),
                    issuedQty: request.deliveries
                        .flatMap((delivery) => delivery.lines)
                        .reduce((sum, line) => sum.plus(this.decimal(line.actualQty)), new Prisma.Decimal(0))
                        .toNumber(),
                    warehouses: [...new Map(request.lines.map((line) => [line.warehouse.id, line.warehouse])).values()],
                    products: [...new Map(request.lines.map((line) => [line.product.id, line.product])).values()],
                }))

            return {
                id: order.id,
                orderNo: order.orderNo,
                orderDate: order.orderDate,
                kind: order.kind,
                status: order.status,
                customer: order.customer,
                salesOwner: order.salesOwner,
                products: order.lines.map((line) => line.product),
                destinations: [
                    ...new Map(
                        order.lines
                            .map((line) => line.receivingWarehouseArea ?? line.issueWarehouse?.area ?? line.issueWarehouse)
                            .filter(Boolean)
                            .map((item) => [item!.id, item]),
                    ).values(),
                ],
                orderedQty: orderedQty.toNumber(),
                deliveredQty: deliveredQty.toNumber(),
                processingQty: processingQty.toNumber(),
                remainingQty: remainingQty.toNumber(),
                progressPercent: orderedQty.isZero()
                    ? 0
                    : Math.min(100, totalDeliveredQty.div(orderedQty).mul(100).toDecimalPlaces(1).toNumber()),
                totalDeliveredQty: totalDeliveredQty.toNumber(),
                revenue: revenue.toNumber(),
                cost: cost.toNumber(),
                profit: profit.toNumber(),
                marginPercent: revenue.isZero() ? null : profit.div(revenue).mul(100).toDecimalPlaces(2).toNumber(),
                projectedRevenue: projectedRevenue.toNumber(),
                costStatus,
                withdrawalCount: withdrawals.length,
                withdrawals,
            }
        })

        if (query.costStatus) rows = rows.filter((row) => row.costStatus === query.costStatus)
        if (query.lossOnly) rows = rows.filter((row) => row.profit < 0)

        const totals = rows.reduce(
            (result, row) => {
                result.revenue += row.revenue
                result.cost += row.cost
                result.profit += row.profit
                result.deliveredQty += row.deliveredQty
                result.remainingLotQty += row.kind === SalesOrderKind.LOT ? row.remainingQty : 0
                result.lossOrders += row.profit < 0 ? 1 : 0
                result.provisionalOrders += row.costStatus === 'PROVISIONAL' ? 1 : 0
                result.noCostOrders += row.costStatus === 'NO_COST_BASIS' && row.deliveredQty > 0 ? 1 : 0
                return result
            },
            {
                revenue: 0,
                cost: 0,
                profit: 0,
                deliveredQty: 0,
                remainingLotQty: 0,
                lossOrders: 0,
                provisionalOrders: 0,
                noCostOrders: 0,
            },
        )

        const salespersonMap = new Map<string, {
            employeeId: string | null
            code: string | null
            name: string
            orderCount: number
            deliveredQty: number
            revenue: number
            profit: number
        }>()
        for (const row of rows) {
            const key = row.salesOwner?.id ?? 'UNASSIGNED'
            const current = salespersonMap.get(key) ?? {
                employeeId: row.salesOwner?.id ?? null,
                code: row.salesOwner?.code ?? null,
                name: row.salesOwner?.fullName || 'Chưa gán Sale',
                orderCount: 0,
                deliveredQty: 0,
                revenue: 0,
                profit: 0,
            }
            current.orderCount += 1
            current.deliveredQty += row.deliveredQty
            current.revenue += row.revenue
            current.profit += row.profit
            salespersonMap.set(key, current)
        }
        const salespeople = [...salespersonMap.values()]
            .map((row) => ({
                ...row,
                marginPercent: row.revenue ? Number(((row.profit / row.revenue) * 100).toFixed(2)) : null,
            }))
            .sort((a, b) => b.profit - a.profit)

        const page = query.page || 1
        const limit = query.limit || 20
        const start = (page - 1) * limit
        return {
            period: { from, to, dateBasis: query.dateBasis },
            summary: {
                ...totals,
                marginPercent: totals.revenue
                    ? Number(((totals.profit / totals.revenue) * 100).toFixed(2))
                    : null,
                orderCount: rows.length,
                lotOrders: rows.filter((row) => row.kind === SalesOrderKind.LOT).length,
                completedLotOrders: rows.filter(
                    (row) => row.kind === SalesOrderKind.LOT && row.remainingQty <= 0,
                ).length,
            },
            salespeople,
            orders: {
                items: rows.slice(start, start + limit),
                total: rows.length,
                page,
                limit,
            },
        }
    }
}
