import { Injectable, NotFoundException } from '@nestjs/common'
import {
    CostLayerEntryType,
    Prisma,
    SalesDeliveryStatus,
    SalesLotInvoiceMode,
    SalesOrderKind,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { PurchaseTermCostLayerService } from 'src/modules/purchases/purchase-term/purchase-term-cost-layer.service'

export type CostStatus = 'FINAL' | 'PROVISIONAL' | 'NO_COST_BASIS'

type SaleSlice = {
    salesDeliveryLineId: string
    inventoryLotId: string
    qty: Prisma.Decimal
    revenue: Prisma.Decimal
    cost: Prisma.Decimal
}

/**
 * Profit and loss per purchase source (spec v1.2 §10).
 *
 * The trace already exists in the data, no extra tables needed:
 *   PurchaseOrder → PurchaseOrderLine → GoodsReceiptLine → InventoryLot
 *     → SalesDeliveryLotAllocation → SalesDeliveryLine → SalesOrder/withdrawal → customer
 *     → SalesInvoice
 * Cost comes from the very same lots via CostLayerEntry, so stock and cost can never tell
 * different stories about which purchase a litre came from.
 */
@Injectable()
export class SalesProfitabilityService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly costLayers: PurchaseTermCostLayerService,
    ) {}

    private decimal(value: Prisma.Decimal | number | string | null | undefined) {
        return new Prisma.Decimal(value ?? 0)
    }

    /**
     * Cost actually charged to a sale: the issue entry plus any later restatement of it.
     * Reversed entries (corrections) drop out. Value leaves the layer as a negative delta,
     * so cost is the negation of the sum.
     */
    private async costBySaleAndLot(tx: PrismaService, salesDeliveryLineIds: string[]) {
        if (!salesDeliveryLineIds.length) return new Map<string, Prisma.Decimal>()
        const entries = await tx.costLayerEntry.findMany({
            where: {
                salesDeliveryLineId: { in: salesDeliveryLineIds },
                type: { in: [CostLayerEntryType.SALES_ISSUE, CostLayerEntryType.REVALUATION] },
                reversedBy: null,
            },
            select: {
                salesDeliveryLineId: true,
                valueDelta: true,
                costLayer: { select: { inventoryLotId: true } },
            },
        })
        const byKey = new Map<string, Prisma.Decimal>()
        for (const entry of entries) {
            const key = `${entry.salesDeliveryLineId}:${entry.costLayer.inventoryLotId}`
            byKey.set(key, (byKey.get(key) ?? new Prisma.Decimal(0)).minus(entry.valueDelta))
        }
        return byKey
    }

    /** Revenue billed for a delivery line — the invoice if issued, otherwise the order price. */
    private revenueOfDeliveryLine(line: {
        actualQty: Prisma.Decimal | null
        orderLine: { orderedActualQty: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal }
        invoiceLines: Array<{ netAmount: Prisma.Decimal }>
    }) {
        const invoiced = line.invoiceLines.reduce(
            (sum, invoiceLine) => sum.plus(invoiceLine.netAmount),
            new Prisma.Decimal(0),
        )
        if (invoiced.greaterThan(0)) return invoiced

        // Not invoiced yet: value it at the order price. discountAmount là chiết khấu trên
        // mỗi đơn vị, nên nhân thẳng với lượng đã xuất.
        const qty = this.decimal(line.actualQty)
        return qty.mul(this.decimal(line.orderLine.unitPrice).minus(this.decimal(line.orderLine.discountAmount)))
    }

    /**
     * A sale that drew from several lots splits its revenue across them in proportion to the
     * quantity taken from each, so per-source profit adds up to the sale's profit.
     */
    private async slicesForLots(inventoryLotIds: string[]): Promise<SaleSlice[]> {
        if (!inventoryLotIds.length) return []
        const allocations = await this.prisma.salesDeliveryLotAllocation.findMany({
            where: {
                inventoryLotId: { in: inventoryLotIds },
                deliveryLine: { delivery: { status: SalesDeliveryStatus.POSTED } },
            },
            include: {
                deliveryLine: {
                    include: {
                        orderLine: {
                            select: {
                                id: true,
                                orderedActualQty: true,
                                unitPrice: true,
                                discountAmount: true,
                            },
                        },
                        invoiceLines: { select: { netAmount: true } },
                        lotAllocations: { select: { actualQty: true } },
                    },
                },
            },
        })

        const costByKey = await this.costBySaleAndLot(
            this.prisma,
            [...new Set(allocations.map((row) => row.salesDeliveryLineId))],
        )

        return allocations.map((allocation) => {
            const deliveryLine = allocation.deliveryLine
            const lineQty = deliveryLine.lotAllocations.reduce(
                (sum, row) => sum.plus(row.actualQty),
                new Prisma.Decimal(0),
            )
            const share = lineQty.isZero()
                ? new Prisma.Decimal(0)
                : this.decimal(allocation.actualQty).div(lineQty)
            return {
                salesDeliveryLineId: allocation.salesDeliveryLineId,
                inventoryLotId: allocation.inventoryLotId,
                qty: this.decimal(allocation.actualQty),
                revenue: this.revenueOfDeliveryLine(deliveryLine).mul(share),
                cost:
                    costByKey.get(`${allocation.salesDeliveryLineId}:${allocation.inventoryLotId}`) ??
                    new Prisma.Decimal(0),
            }
        })
    }

    /**
     * What a LOT or TERM purchase turned into: how much came in, how much was sold, to whom,
     * at what margin, and whether the cost behind it is final yet.
     */
    async purchaseSourceReport(purchaseOrderId: string) {
        const order = await this.prisma.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            include: {
                supplier: { select: { id: true, code: true, name: true } },
                lines: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        receiptLines: {
                            include: {
                                lot: {
                                    include: {
                                        costLayers: {
                                            select: {
                                                remainingActualQty: true,
                                                remainingValue: true,
                                                isProvisional: true,
                                            },
                                        },
                                    },
                                },
                                goodsReceipt: { select: { id: true, receiptNo: true, receiptDate: true } },
                            },
                        },
                    },
                },
            },
        })
        if (!order) throw new NotFoundException('PURCHASE_ORDER_NOT_FOUND')

        const lots = order.lines.flatMap((line) =>
            line.receiptLines
                .filter((receiptLine) => receiptLine.lot)
                .map((receiptLine) => ({
                    lot: receiptLine.lot!,
                    receiptLine,
                    product: line.product,
                })),
        )
        const slices = await this.slicesForLots(lots.map((row) => row.lot.id))

        // Fill in the sales context for the rows we are about to show.
        const deliveryLineIds = [...new Set(slices.map((row) => row.salesDeliveryLineId))]
        const deliveryLines = deliveryLineIds.length
            ? await this.prisma.salesDeliveryLine.findMany({
                  where: { id: { in: deliveryLineIds } },
                  include: {
                      delivery: {
                          select: {
                              id: true,
                              deliveryNo: true,
                              deliveredAt: true,
                              withdrawalRequest: { select: { id: true, requestNo: true } },
                              salesOrder: {
                                  select: {
                                      id: true,
                                      orderNo: true,
                                      kind: true,
                                      customer: { select: { id: true, code: true, name: true } },
                                  },
                              },
                          },
                      },
                      invoiceLines: {
                          select: {
                              invoice: {
                                  select: { id: true, invoiceNoInternal: true, misaInvoiceNo: true, status: true },
                              },
                          },
                      },
                  },
              })
            : []
        const deliveryLineById = new Map(deliveryLines.map((line) => [line.id, line]))

        let receivedQty = new Prisma.Decimal(0)
        let remainingQty = new Prisma.Decimal(0)
        let hasProvisional = false
        let hasCostLayer = false
        for (const row of lots) {
            receivedQty = receivedQty.plus(row.lot.receivedActualQty)
            for (const layer of row.lot.costLayers) {
                hasCostLayer = true
                remainingQty = remainingQty.plus(layer.remainingActualQty)
                if (layer.isProvisional) hasProvisional = true
            }
        }

        const sales = slices.map((slice) => {
            const deliveryLine = deliveryLineById.get(slice.salesDeliveryLineId)
            const invoice = deliveryLine?.invoiceLines[0]?.invoice ?? null
            const profit = slice.revenue.minus(slice.cost)
            return {
                salesOrderId: deliveryLine?.delivery.salesOrder.id ?? null,
                orderNo: deliveryLine?.delivery.salesOrder.orderNo ?? null,
                orderKind: deliveryLine?.delivery.salesOrder.kind ?? null,
                withdrawalRequestNo: deliveryLine?.delivery.withdrawalRequest?.requestNo ?? null,
                customer: deliveryLine?.delivery.salesOrder.customer ?? null,
                deliveryNo: deliveryLine?.delivery.deliveryNo ?? null,
                deliveredAt: deliveryLine?.delivery.deliveredAt ?? null,
                invoiceNo: invoice?.misaInvoiceNo ?? invoice?.invoiceNoInternal ?? null,
                invoiceStatus: invoice?.status ?? null,
                inventoryLotId: slice.inventoryLotId,
                qty: slice.qty.toString(),
                revenue: slice.revenue.toString(),
                cost: slice.cost.toString(),
                profit: profit.toString(),
                marginPercent: slice.revenue.isZero()
                    ? null
                    : profit.div(slice.revenue).mul(100).toFixed(2),
            }
        })

        const soldQty = slices.reduce((sum, row) => sum.plus(row.qty), new Prisma.Decimal(0))
        const totalRevenue = slices.reduce((sum, row) => sum.plus(row.revenue), new Prisma.Decimal(0))
        const totalCost = slices.reduce((sum, row) => sum.plus(row.cost), new Prisma.Decimal(0))
        const totalProfit = totalRevenue.minus(totalCost)

        // Margin on a provisional cost is an estimate: finalising the TERM price restates it.
        const costStatus: CostStatus = !hasCostLayer
            ? 'NO_COST_BASIS'
            : hasProvisional
              ? 'PROVISIONAL'
              : 'FINAL'

        return {
            purchaseOrder: {
                id: order.id,
                orderNo: order.orderNo,
                orderType: order.orderType,
                bizType: order.bizType,
                orderDate: order.orderDate,
                supplier: order.supplier,
            },
            quantities: {
                receivedQty: receivedQty.toString(),
                soldQty: soldQty.toString(),
                remainingQty: remainingQty.toString(),
            },
            totals: {
                revenue: totalRevenue.toString(),
                cost: totalCost.toString(),
                profit: totalProfit.toString(),
                marginPercent: totalRevenue.isZero()
                    ? null
                    : totalProfit.div(totalRevenue).mul(100).toFixed(2),
            },
            costStatus,
            lots: lots.map((row) => ({
                inventoryLotId: row.lot.id,
                lotNo: row.lot.lotNo,
                product: row.product,
                receiptNo: row.receiptLine.goodsReceipt.receiptNo,
                receiptDate: row.receiptLine.goodsReceipt.receiptDate,
                receivedQty: row.lot.receivedActualQty.toString(),
                remainingQty: row.lot.costLayers
                    .reduce((sum, layer) => sum.plus(layer.remainingActualQty), new Prisma.Decimal(0))
                    .toString(),
                isProvisional: row.lot.costLayers.some((layer) => layer.isProvisional),
            })),
            sales,
        }
    }

    /** The same numbers seen from a sale: which purchases fed it, and at what margin. */
    async salesOrderProfitability(salesOrderId: string) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id: salesOrderId },
            include: {
                customer: { select: { id: true, code: true, name: true } },
                deliveries: {
                    where: { status: SalesDeliveryStatus.POSTED },
                    include: {
                        lines: {
                            include: {
                                orderLine: {
                                    select: {
                                        id: true,
                                        lineNo: true,
                                        orderedActualQty: true,
                                        unitPrice: true,
                                        discountAmount: true,
                                        product: { select: { id: true, code: true, name: true } },
                                    },
                                },
                                invoiceLines: { select: { netAmount: true } },
                                lotAllocations: {
                                    include: {
                                        lot: {
                                            include: {
                                                costLayers: { select: { isProvisional: true } },
                                                receiptLine: {
                                                    include: {
                                                        purchaseOrderLine: {
                                                            include: {
                                                                purchaseOrder: {
                                                                    select: {
                                                                        id: true,
                                                                        orderNo: true,
                                                                        orderType: true,
                                                                        bizType: true,
                                                                        supplier: {
                                                                            select: { id: true, code: true, name: true },
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })
        if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')

        const allDeliveryLineIds = order.deliveries.flatMap((delivery) =>
            delivery.lines.map((line) => line.id),
        )
        const costByKey = await this.costBySaleAndLot(this.prisma, allDeliveryLineIds)

        const rows: Array<Record<string, unknown>> = []
        let hasProvisional = false
        let totalRevenue = new Prisma.Decimal(0)
        let totalCost = new Prisma.Decimal(0)

        for (const delivery of order.deliveries) {
            for (const line of delivery.lines) {
                const lineQty = line.lotAllocations.reduce(
                    (sum, row) => sum.plus(row.actualQty),
                    new Prisma.Decimal(0),
                )
                const lineRevenue = this.revenueOfDeliveryLine(line)
                for (const allocation of line.lotAllocations) {
                    const share = lineQty.isZero()
                        ? new Prisma.Decimal(0)
                        : this.decimal(allocation.actualQty).div(lineQty)
                    const revenue = lineRevenue.mul(share)
                    const cost =
                        costByKey.get(`${line.id}:${allocation.inventoryLotId}`) ?? new Prisma.Decimal(0)
                    const profit = revenue.minus(cost)
                    const purchaseOrder =
                        allocation.lot.receiptLine?.purchaseOrderLine?.purchaseOrder ?? null
                    if (allocation.lot.costLayers.some((layer) => layer.isProvisional)) {
                        hasProvisional = true
                    }
                    totalRevenue = totalRevenue.plus(revenue)
                    totalCost = totalCost.plus(cost)
                    rows.push({
                        deliveryNo: delivery.deliveryNo,
                        lineNo: line.orderLine.lineNo,
                        product: line.orderLine.product,
                        inventoryLotId: allocation.inventoryLotId,
                        lotNo: allocation.lot.lotNo,
                        purchaseOrderId: purchaseOrder?.id ?? null,
                        purchaseOrderNo: purchaseOrder?.orderNo ?? null,
                        // TERM vs commercial is bizType; orderType only says SINGLE vs LOT.
                        purchaseBizType: purchaseOrder?.bizType ?? null,
                        purchaseOrderType: purchaseOrder?.orderType ?? null,
                        supplier: purchaseOrder?.supplier ?? null,
                        qty: this.decimal(allocation.actualQty).toString(),
                        revenue: revenue.toString(),
                        cost: cost.toString(),
                        profit: profit.toString(),
                    })
                }
            }
        }

        // Đơn lô đã xuất hóa đơn cả lô: doanh thu ghi nhận hết ngay, kể cả phần khách
        // chưa rút. Phần chưa rút chưa gắn được lô hàng nào nên giá vốn phải ước tính,
        // và sẽ được thay bằng giá vốn thật khi kho xuất.
        let hasEstimatedCost = false
        if (
            order.kind === SalesOrderKind.LOT &&
            order.lotInvoiceMode === SalesLotInvoiceMode.ON_CONFIRMATION
        ) {
            const undrawnRows = await this.undrawnLotRows(order.id)
            for (const row of undrawnRows) {
                hasEstimatedCost = true
                totalRevenue = totalRevenue.plus(row.revenueDecimal)
                totalCost = totalCost.plus(row.costDecimal)
                rows.push(row.display)
            }
        }

        const totalProfit = totalRevenue.minus(totalCost)
        return {
            salesOrder: {
                id: order.id,
                orderNo: order.orderNo,
                kind: order.kind,
                orderDate: order.orderDate,
                customer: order.customer,
            },
            totals: {
                revenue: totalRevenue.toString(),
                cost: totalCost.toString(),
                profit: totalProfit.toString(),
                marginPercent: totalRevenue.isZero()
                    ? null
                    : totalProfit.div(totalRevenue).mul(100).toFixed(2),
            },
            costStatus: (rows.length === 0
                ? 'NO_COST_BASIS'
                : hasProvisional || hasEstimatedCost
                  ? 'PROVISIONAL'
                  : 'FINAL') as CostStatus,
            /** Có phần giá vốn còn là ước tính vì khách chưa rút hết lô. */
            hasEstimatedCost,
            sources: rows,
        }
    }

    /**
     * Phần lô khách chưa rút: doanh thu đã nằm trên hóa đơn nên tính đủ, còn giá vốn
     * ước theo FIFO của tồn hiện có tại chính kho xuất của dòng đơn.
     */
    private async undrawnLotRows(salesOrderId: string) {
        const orderLines = await this.prisma.salesOrderLine.findMany({
            where: { salesOrderId },
            include: {
                product: { select: { id: true, code: true, name: true } },
                issueWarehouse: {
                    select: { id: true, name: true, legalEntity: { select: { partyId: true } } },
                },
                deliveryLines: {
                    where: { delivery: { status: SalesDeliveryStatus.POSTED } },
                    select: { actualQty: true },
                },
            },
            orderBy: { lineNo: 'asc' },
        })

        const result: Array<{
            revenueDecimal: Prisma.Decimal
            costDecimal: Prisma.Decimal
            display: Record<string, unknown>
        }> = []

        for (const line of orderLines) {
            const drawn = line.deliveryLines.reduce(
                (sum, row) => sum.plus(this.decimal(row.actualQty)),
                new Prisma.Decimal(0),
            )
            const undrawn = this.decimal(line.orderedActualQty).minus(drawn)
            if (!undrawn.greaterThan(0)) continue

            const revenue = undrawn.mul(
                this.decimal(line.unitPrice).minus(this.decimal(line.discountAmount)),
            )
            let cost = new Prisma.Decimal(0)
            if (line.issueWarehouse) {
                const estimate = await this.costLayers.estimateFifoCostInTx(this.prisma, {
                    warehouseId: line.issueWarehouse.id,
                    productId: line.productId,
                    ownerPartyId: line.issueWarehouse.legalEntity.partyId,
                    qty: undrawn,
                })
                if (estimate) cost = estimate.cost
            }

            result.push({
                revenueDecimal: revenue,
                costDecimal: cost,
                display: {
                    deliveryNo: null,
                    lineNo: line.lineNo,
                    product: line.product,
                    inventoryLotId: null,
                    lotNo: null,
                    purchaseOrderId: null,
                    purchaseOrderNo: null,
                    purchaseBizType: null,
                    purchaseOrderType: null,
                    supplier: null,
                    qty: undrawn.toString(),
                    revenue: revenue.toString(),
                    cost: cost.toString(),
                    profit: revenue.minus(cost).toString(),
                    /** Dòng chưa rút: giá vốn là ước tính, chưa gắn lô mua nào. */
                    isEstimated: true,
                },
            })
        }
        return result
    }
}
