import { Injectable } from '@nestjs/common'
import {
    Prisma,
    SalesDeliveryStatus,
    SalesOrderKind,
    SalesOrderStatus,
    SalesReconciliationStatus,
} from '@prisma/client'

/**
 * The order status is DERIVED from its children, never set directly by a warehouse
 * (spec v1.2 nguyên tắc 13, §4.1). Always call inside the transaction that changed a child.
 */
@Injectable()
export class SalesOrderStatusService {
    /** Statuses that must not be recomputed away. */
    private readonly frozen: SalesOrderStatus[] = [
        SalesOrderStatus.DRAFT,
        SalesOrderStatus.PENDING_REVIEW,
        SalesOrderStatus.REJECTED,
        SalesOrderStatus.CANCELLED,
        SalesOrderStatus.COMPLETED,
    ]

    async recompute(tx: Prisma.TransactionClient, orderId: string): Promise<SalesOrderStatus | null> {
        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: {
                lines: { select: { id: true, orderedActualQty: true } },
                deliveries: {
                    where: { status: { not: SalesDeliveryStatus.VOIDED } },
                    select: { id: true, status: true },
                },
                reservations: {
                    include: { lines: { select: { salesOrderLineId: true, activeActualQty: true } } },
                },
                reconciliation: {
                    include: {
                        lines: {
                            where: {
                                supersededById: null,
                                delivery: { status: { not: SalesDeliveryStatus.VOIDED } },
                            },
                            select: { status: true },
                        },
                    },
                },
            },
        })
        if (this.frozen.includes(order.status)) return null
        // Lot orders stay CONFIRMED ("đang hoạt động") — their stock movement happens on
        // withdrawal requests, not on the lot order itself (GĐ 5).
        if (order.kind !== SalesOrderKind.SINGLE) return null

        const next = this.derive(order)
        if (next === order.status) return order.status
        await tx.salesOrder.update({
            where: { id: orderId },
            data: { status: next, version: { increment: 1 } },
        })
        return next
    }

    private derive(order: {
        status: SalesOrderStatus
        lines: Array<{ id: string; orderedActualQty: Prisma.Decimal }>
        deliveries: Array<{ status: SalesDeliveryStatus }>
        reservations: Array<{ lines: Array<{ salesOrderLineId: string | null; activeActualQty: Prisma.Decimal }> }>
        reconciliation: { lines: Array<{ status: SalesReconciliationStatus }> } | null
    }): SalesOrderStatus {
        const deliveries = order.deliveries
        if (deliveries.length) {
            const posted = deliveries.filter((row) => row.status === SalesDeliveryStatus.POSTED).length
            if (posted === deliveries.length) {
                // Warehouse work is done; reconciliation decides whether invoicing may start.
                const reconLines = order.reconciliation?.lines ?? []
                if (!reconLines.length) return SalesOrderStatus.DELIVERED
                const settled = reconLines.every(
                    (line) =>
                        line.status === SalesReconciliationStatus.MATCHED ||
                        line.status === SalesReconciliationStatus.RESOLVED,
                )
                return settled ? SalesOrderStatus.AWAITING_INVOICE : SalesOrderStatus.AWAITING_RECONCILIATION
            }
            if (posted > 0) return SalesOrderStatus.PARTIALLY_DELIVERED
            return SalesOrderStatus.WAREHOUSE_PROCESSING
        }

        const heldByLine = new Map<string, Prisma.Decimal>()
        for (const reservation of order.reservations) {
            for (const line of reservation.lines) {
                if (!line.salesOrderLineId) continue
                heldByLine.set(
                    line.salesOrderLineId,
                    (heldByLine.get(line.salesOrderLineId) ?? new Prisma.Decimal(0)).plus(line.activeActualQty),
                )
            }
        }
        if (!heldByLine.size) {
            // Nothing held yet: an approved order simply waits for stock.
            return order.status === SalesOrderStatus.CONFIRMED
                ? SalesOrderStatus.CONFIRMED
                : SalesOrderStatus.AWAITING_STOCK
        }
        const fullyHeld = order.lines.every((line) =>
            (heldByLine.get(line.id) ?? new Prisma.Decimal(0)).greaterThanOrEqualTo(line.orderedActualQty),
        )
        if (fullyHeld) return SalesOrderStatus.RESERVED
        const anyHeld = [...heldByLine.values()].some((qty) => qty.greaterThan(0))
        return anyHeld ? SalesOrderStatus.PARTIALLY_RESERVED : SalesOrderStatus.AWAITING_STOCK
    }
}
