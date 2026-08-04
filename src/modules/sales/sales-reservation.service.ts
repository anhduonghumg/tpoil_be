import { Injectable } from '@nestjs/common'
import {
    Prisma,
    ReservationEventType,
    ReservationStatus,
    SalesOrderKind,
    SalesOrderStatus,
} from '@prisma/client'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { SalesActor } from './sales-order-workflow.service'

export type ReserveLineOutcome = {
    salesOrderLineId: string
    lineNo: number
    productId: string
    productName: string
    warehouseId: string
    warehouseName: string
    requestedQty: string
    reservedQty: string
    shortageQty: string
}

export type ReserveOutcome = {
    reservationId: string | null
    fullyReserved: boolean
    lines: ReserveLineOutcome[]
}

/**
 * Holds stock for an approved SINGLE/LOT order (spec v1.2 §4.1).
 *
 * A hold only reduces AVAILABLE quantity — physical stock moves when the warehouse
 * confirms the issue (GĐ 3). Holds are taken per order line so "đang giữ" stays
 * attributable even when several lines share warehouse+product+owner.
 */
@Injectable()
export class SalesReservationService {
    constructor(
        private readonly inventory: InventoryCoreService,
        private readonly events: SalesWorkflowEventsService,
    ) {}

    private async nextReservationNo(tx: Prisma.TransactionClient, orderDate: Date) {
        const year = String(orderDate.getUTCFullYear()).slice(-2)
        const month = String(orderDate.getUTCMonth() + 1).padStart(2, '0')
        const period = `${year}${month}`
        const sequence = await tx.documentSequence.upsert({
            where: { moduleCode_period: { moduleCode: 'SALES_RESERVATION', period } },
            create: { moduleCode: 'SALES_RESERVATION', period, currentNo: 1 },
            update: { currentNo: { increment: 1 } },
        })
        return `GH${period}${String(sequence.currentNo).padStart(4, '0')}`
    }

    /** Available = onHand − reserved − pending − blocked, per warehouse+product+owner (D2). */
    private async availableQty(
        tx: Prisma.TransactionClient,
        key: { warehouseId: string; productId: string; ownerPartyId: string },
    ) {
        const balance = await tx.inventoryAvailabilityBalance.findUnique({
            where: { warehouseId_productId_ownerPartyId: key },
        })
        if (!balance) return new Prisma.Decimal(0)
        return new Prisma.Decimal(balance.onHandActualQty)
            .minus(balance.reservedActualQty)
            .minus(balance.pendingActualQty)
            .minus(balance.blockedActualQty)
    }

    /**
     * Takes (or tops up) the hold for every line of the order. Never throws on shortage:
     * a partially covered order stays open at PARTIALLY_RESERVED/AWAITING_STOCK so sales
     * can retry once stock arrives.
     */
    async reserveOrder(
        tx: Prisma.TransactionClient,
        orderId: string,
        actor: SalesActor,
    ): Promise<ReserveOutcome> {
        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: {
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        product: { select: { name: true } },
                        issueWarehouse: {
                            select: {
                                id: true,
                                name: true,
                                legalEntity: { select: { partyId: true } },
                            },
                        },
                    },
                },
            },
        })

        // Lot orders commit a quantity, they do not hold stock — holds belong to each
        // withdrawal request instead (GĐ 5).
        if (order.kind !== SalesOrderKind.SINGLE) {
            return { reservationId: null, fullyReserved: true, lines: [] }
        }

        // A reservation line is a one-shot ledger: active + released + consumed may never
        // exceed requested (DB check). Once consumed — e.g. a correction voided the issue —
        // the line has no headroom left, so the next round needs a NEW reservation (P0-5).
        const openReservations = await tx.inventoryReservation.findMany({
            where: {
                salesOrderId: orderId,
                status: { in: [ReservationStatus.DRAFT, ReservationStatus.ACTIVE] },
            },
            include: { lines: true },
        })
        const headroom = (line: { requestedActualQty: Prisma.Decimal; activeActualQty: Prisma.Decimal; releasedActualQty: Prisma.Decimal; consumedActualQty: Prisma.Decimal }) =>
            new Prisma.Decimal(line.requestedActualQty)
                .minus(line.activeActualQty)
                .minus(line.releasedActualQty)
                .minus(line.consumedActualQty)

        const reservationLineByOrderLine = new Map<string, (typeof openReservations)[number]['lines'][number]>()
        const alreadyHeld = new Map<string, Prisma.Decimal>()
        for (const reservation of openReservations) {
            for (const line of reservation.lines) {
                if (!line.salesOrderLineId) continue
                alreadyHeld.set(
                    line.salesOrderLineId,
                    (alreadyHeld.get(line.salesOrderLineId) ?? new Prisma.Decimal(0)).plus(line.activeActualQty),
                )
                if (headroom(line).greaterThan(0) && !reservationLineByOrderLine.has(line.salesOrderLineId)) {
                    reservationLineByOrderLine.set(line.salesOrderLineId, line)
                }
            }
        }

        // Lines still short of their ordered quantity and without a usable ledger row.
        const needFreshLines = order.lines.filter((line) => {
            if (!line.issueWarehouse) return false
            if (reservationLineByOrderLine.has(line.id)) return false
            const held = alreadyHeld.get(line.id) ?? new Prisma.Decimal(0)
            return new Prisma.Decimal(line.orderedActualQty).minus(held).greaterThan(0)
        })

        let reservationId = openReservations[0]?.id ?? null
        if (needFreshLines.length) {
            const fresh = await tx.inventoryReservation.create({
                data: {
                    reservationNo: await this.nextReservationNo(tx, order.orderDate),
                    legalEntityId: order.legalEntityId,
                    customerPartyId: order.customerPartyId,
                    salesOrderId: orderId,
                    // Sales holds never expire on their own; they are released by an explicit
                    // cancel/correction (spec v1.2 nguyên tắc 2).
                    expiresAt: null,
                    note: `Giữ hàng cho đơn bán ${order.orderNo}`,
                    lines: {
                        create: needFreshLines.map((line, index) => ({
                            lineNo: index + 1,
                            warehouseId: line.issueWarehouse!.id,
                            productId: line.productId,
                            ownerPartyId: line.issueWarehouse!.legalEntity.partyId,
                            salesOrderLineId: line.id,
                            requestedActualQty: new Prisma.Decimal(line.orderedActualQty).minus(
                                alreadyHeld.get(line.id) ?? 0,
                            ),
                            requestedV15Qty: line.orderedV15Qty,
                        })),
                    },
                },
                include: { lines: true },
            })
            reservationId = reservationId ?? fresh.id
            for (const line of fresh.lines) {
                if (line.salesOrderLineId) reservationLineByOrderLine.set(line.salesOrderLineId, line)
            }
        }

        const outcomes: ReserveLineOutcome[] = []
        for (const orderLine of order.lines) {
            if (!orderLine.issueWarehouse) continue
            const orderedQty = new Prisma.Decimal(orderLine.orderedActualQty)
            const reservationLine = reservationLineByOrderLine.get(orderLine.id)
            let reservedNow = alreadyHeld.get(orderLine.id) ?? new Prisma.Decimal(0)

            if (!reservationLine) {
                outcomes.push({
                    salesOrderLineId: orderLine.id,
                    lineNo: orderLine.lineNo,
                    productId: orderLine.productId,
                    productName: orderLine.product.name,
                    warehouseId: orderLine.issueWarehouse.id,
                    warehouseName: orderLine.issueWarehouse.name,
                    requestedQty: orderedQty.toString(),
                    reservedQty: reservedNow.toString(),
                    shortageQty: Prisma.Decimal.max(orderedQty.minus(reservedNow), 0).toString(),
                })
                continue
            }

            // How much this ledger row may still take, capped by what the order still needs.
            const missing = Prisma.Decimal.min(
                headroom(reservationLine),
                orderedQty.minus(reservedNow),
            )

            // Decimal treats zero as positively signed — compare explicitly.
            if (missing.greaterThan(0)) {
                const available = await this.availableQty(tx, {
                    warehouseId: reservationLine.warehouseId,
                    productId: reservationLine.productId,
                    ownerPartyId: reservationLine.ownerPartyId,
                })
                const takeQty = Prisma.Decimal.min(missing, available)
                if (takeQty.greaterThan(0)) {
                    // Consumption resets activeActualQty to 0, so the running total is not a
                    // stable discriminator — a correction revision would collide with the
                    // original hold's key and be skipped as a duplicate. Count activations.
                    const attempt = await tx.inventoryReservationEvent.count({
                        where: {
                            reservationLineId: reservationLine.id,
                            type: ReservationEventType.ACTIVATE,
                        },
                    })
                    await this.inventory.activateReservationLine(tx, {
                        reservationLineId: reservationLine.id,
                        actualQty: takeQty,
                        // V15 is only tracked when the order asked for it.
                        v15Qty:
                            reservationLine.requestedV15Qty == null
                                ? null
                                : new Prisma.Decimal(reservationLine.requestedV15Qty)
                                      .minus(reservationLine.activeV15Qty ?? 0)
                                      .times(takeQty)
                                      .div(missing),
                        idempotencyKey: `sales-order:${orderId}:reserve:${reservationLine.id}:${attempt}`,
                        occurredAt: new Date(),
                        actorId: actor.userId,
                        reason: `Giữ hàng đơn bán ${order.orderNo}`,
                    })
                    reservedNow = reservedNow.plus(takeQty)
                }
            }

            outcomes.push({
                salesOrderLineId: orderLine.id,
                lineNo: orderLine.lineNo,
                productId: orderLine.productId,
                productName: orderLine.product.name,
                warehouseId: orderLine.issueWarehouse.id,
                warehouseName: orderLine.issueWarehouse.name,
                requestedQty: orderedQty.toString(),
                reservedQty: reservedNow.toString(),
                shortageQty: Prisma.Decimal.max(orderedQty.minus(reservedNow), 0).toString(),
            })
        }

        const fullyReserved =
            outcomes.length > 0 && outcomes.every((row) => new Prisma.Decimal(row.shortageQty).isZero())

        await this.events.record(tx, {
            entityType: 'SALES_ORDER',
            entityId: orderId,
            eventType: 'RESERVE',
            actorId: actor.userId,
            toStatus: fullyReserved
                ? SalesOrderStatus.RESERVED
                : outcomes.some((row) => !new Prisma.Decimal(row.reservedQty).isZero())
                  ? SalesOrderStatus.PARTIALLY_RESERVED
                  : SalesOrderStatus.AWAITING_STOCK,
            metadata: { lines: outcomes } as unknown as Prisma.InputJsonObject,
        })

        return { reservationId, fullyReserved, lines: outcomes }
    }

    /** Releases every active hold of an order (cancel path). */
    async releaseOrder(tx: Prisma.TransactionClient, orderId: string, actor: SalesActor, reason: string) {
        const reservations = await tx.inventoryReservation.findMany({
            where: {
                salesOrderId: orderId,
                status: { in: [ReservationStatus.DRAFT, ReservationStatus.ACTIVE, ReservationStatus.PARTIALLY_RELEASED] },
            },
            include: { lines: true },
        })
        for (const reservation of reservations) {
            for (const line of reservation.lines) {
                if (!new Prisma.Decimal(line.activeActualQty).greaterThan(0)) continue
                await this.inventory.releaseReservationLine(tx, {
                    reservationLineId: line.id,
                    actualQty: line.activeActualQty,
                    v15Qty: line.activeV15Qty,
                    idempotencyKey: `sales-order:${orderId}:release:${line.id}`,
                    occurredAt: new Date(),
                    actorId: actor.userId,
                    reason,
                })
            }
            await tx.inventoryReservation.update({
                where: { id: reservation.id },
                data: { status: ReservationStatus.RELEASED, version: { increment: 1 } },
            })
        }
        return reservations.length
    }
}
