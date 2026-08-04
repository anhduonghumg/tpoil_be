import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    ReservationStatus,
    SalesApprovalStatus,
    SalesOrderKind,
    SalesOrderStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import { CreateLotAdjustmentDto, DecideLotAdjustmentDto } from './dto/sales-lot.dto'

export type LotBalance = {
    salesOrderLineId: string
    lotPositionId: string
    productId: string
    productName: string
    warehouseId: string | null
    warehouseName: string | null
    totalQty: string
    issuedQty: string
    adjustedQty: string
    /** Held for approved draws that have not been issued yet — derived, never stored. */
    heldQty: string
    remainingQty: string
}

/**
 * Draw balance of LOT orders (spec v1.2 §3.4, §4.2).
 *
 * Còn rút được = tổng lô − đã xuất thực − điều chỉnh đã duyệt − đang giữ.
 * "Đang giữ" is computed from active reservation lines so it can never drift from the
 * inventory ledger.
 */
@Injectable()
export class SalesLotService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly events: SalesWorkflowEventsService,
    ) {}

    /** Creates the positions when a LOT order is approved. Idempotent. */
    async openPositions(tx: Prisma.TransactionClient, orderId: string) {
        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: { lines: { include: { lotPosition: true } } },
        })
        if (order.kind !== SalesOrderKind.LOT) return 0

        let created = 0
        for (const line of order.lines) {
            if (line.lotPosition) continue
            await tx.salesLotPosition.create({
                data: { salesOrderLineId: line.id, totalQty: line.orderedActualQty },
            })
            created += 1
        }
        return created
    }

    /** Quantity held by approved-but-not-yet-issued draws of this lot order line. */
    private async heldQty(tx: Prisma.TransactionClient | PrismaService, salesOrderLineId: string) {
        const lines = await tx.inventoryReservationLine.findMany({
            where: {
                withdrawalRequestLine: { salesOrderLineId },
                reservation: {
                    status: { in: [ReservationStatus.DRAFT, ReservationStatus.ACTIVE, ReservationStatus.PARTIALLY_RELEASED] },
                },
            },
            select: { activeActualQty: true },
        })
        return lines.reduce((sum, line) => sum.plus(line.activeActualQty), new Prisma.Decimal(0))
    }

    async balanceForLine(
        tx: Prisma.TransactionClient | PrismaService,
        salesOrderLineId: string,
    ): Promise<LotBalance | null> {
        const line = await tx.salesOrderLine.findUnique({
            where: { id: salesOrderLineId },
            include: {
                lotPosition: true,
                product: { select: { name: true } },
                issueWarehouse: { select: { id: true, name: true } },
            },
        })
        if (!line?.lotPosition) return null

        const held = await this.heldQty(tx, salesOrderLineId)
        const position = line.lotPosition
        const remaining = new Prisma.Decimal(position.totalQty)
            .minus(position.issuedQty)
            .minus(position.adjustedQty)
            .minus(held)
        return {
            salesOrderLineId,
            lotPositionId: position.id,
            productId: line.productId,
            productName: line.product.name,
            warehouseId: line.issueWarehouse?.id ?? null,
            warehouseName: line.issueWarehouse?.name ?? null,
            totalQty: position.totalQty.toString(),
            issuedQty: position.issuedQty.toString(),
            adjustedQty: position.adjustedQty.toString(),
            heldQty: held.toString(),
            remainingQty: Prisma.Decimal.max(remaining, 0).toString(),
        }
    }

    async detail(orderId: string) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id: orderId },
            include: {
                customer: { select: { id: true, code: true, name: true } },
                lines: { orderBy: { lineNo: 'asc' } },
                withdrawals: {
                    orderBy: { createdAt: 'desc' },
                    include: { lines: true },
                },
            },
        })
        if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
        if (order.kind !== SalesOrderKind.LOT) {
            throw new BadRequestException({
                code: 'SALES_ORDER_NOT_LOT',
                message: 'Đơn này không phải đơn lô.',
            })
        }
        const balances = await Promise.all(
            order.lines.map((line) => this.balanceForLine(this.prisma, line.id)),
        )
        return { ...order, balances: balances.filter((row): row is LotBalance => row !== null) }
    }

    /**
     * Commercial stock a customer still holds across all their active lot orders —
     * the "tồn của khách" report (spec v1.2 §11 tầng 3).
     */
    async customerStock(params: { customerPartyId?: string; productId?: string }) {
        const positions = await this.prisma.salesLotPosition.findMany({
            where: {
                orderLine: {
                    productId: params.productId ?? undefined,
                    salesOrder: {
                        kind: SalesOrderKind.LOT,
                        status: SalesOrderStatus.CONFIRMED,
                        customerPartyId: params.customerPartyId ?? undefined,
                    },
                },
            },
            include: {
                orderLine: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        issueWarehouse: { select: { id: true, code: true, name: true } },
                        salesOrder: {
                            select: {
                                id: true,
                                orderNo: true,
                                orderDate: true,
                                customer: { select: { id: true, code: true, name: true } },
                            },
                        },
                    },
                },
            },
        })

        const rows = await Promise.all(
            positions.map(async (position) => {
                const held = await this.heldQty(this.prisma, position.salesOrderLineId)
                const remaining = new Prisma.Decimal(position.totalQty)
                    .minus(position.issuedQty)
                    .minus(position.adjustedQty)
                    .minus(held)
                return {
                    customer: position.orderLine.salesOrder.customer,
                    salesOrderId: position.orderLine.salesOrder.id,
                    orderNo: position.orderLine.salesOrder.orderNo,
                    orderDate: position.orderLine.salesOrder.orderDate,
                    salesOrderLineId: position.salesOrderLineId,
                    product: position.orderLine.product,
                    warehouse: position.orderLine.issueWarehouse,
                    totalQty: position.totalQty.toString(),
                    issuedQty: position.issuedQty.toString(),
                    adjustedQty: position.adjustedQty.toString(),
                    heldQty: held.toString(),
                    remainingQty: Prisma.Decimal.max(remaining, 0).toString(),
                }
            }),
        )

        // Group by customer × product so the report answers "khách X còn bao nhiêu mặt hàng Y".
        const summary = new Map<
            string,
            {
                customer: (typeof rows)[number]['customer']
                product: (typeof rows)[number]['product']
                totalQty: Prisma.Decimal
                issuedQty: Prisma.Decimal
                heldQty: Prisma.Decimal
                remainingQty: Prisma.Decimal
                lotOrders: number
            }
        >()
        for (const row of rows) {
            const key = `${row.customer.id}:${row.product.id}`
            const current = summary.get(key) ?? {
                customer: row.customer,
                product: row.product,
                totalQty: new Prisma.Decimal(0),
                issuedQty: new Prisma.Decimal(0),
                heldQty: new Prisma.Decimal(0),
                remainingQty: new Prisma.Decimal(0),
                lotOrders: 0,
            }
            current.totalQty = current.totalQty.plus(row.totalQty)
            current.issuedQty = current.issuedQty.plus(row.issuedQty)
            current.heldQty = current.heldQty.plus(row.heldQty)
            current.remainingQty = current.remainingQty.plus(row.remainingQty)
            current.lotOrders += 1
            summary.set(key, current)
        }

        return {
            summary: [...summary.values()].map((row) => ({
                ...row,
                totalQty: row.totalQty.toString(),
                issuedQty: row.issuedQty.toString(),
                heldQty: row.heldQty.toString(),
                remainingQty: row.remainingQty.toString(),
            })),
            details: rows,
        }
    }

    /** Adds to issuedQty when the warehouse posts a draw; negative to undo a correction. */
    async applyIssued(
        tx: Prisma.TransactionClient,
        salesOrderLineId: string,
        deltaQty: Prisma.Decimal,
        actorId?: string | null,
    ) {
        const position = await tx.salesLotPosition.findUnique({ where: { salesOrderLineId } })
        if (!position) return null
        const issuedQty = new Prisma.Decimal(position.issuedQty).plus(deltaQty)
        if (issuedQty.lessThan(0)) {
            throw new BadRequestException({
                code: 'LOT_ISSUED_QTY_NEGATIVE',
                message: 'Số đã rút không thể âm.',
            })
        }
        await tx.salesLotPosition.update({
            where: { id: position.id },
            data: { issuedQty, version: { increment: 1 } },
        })
        await this.events.record(tx, {
            entityType: 'SALES_ORDER',
            entityId: salesOrderLineId,
            eventType: deltaQty.greaterThan(0) ? 'LOT_ISSUE' : 'LOT_ISSUE_REVERSE',
            actorId: actorId ?? null,
            metadata: { deltaQty: deltaQty.toString(), issuedQty: issuedQty.toString() },
        })
        return issuedQty
    }

    /** Closes a lot order once every position is fully drawn or written down. */
    async closeIfComplete(tx: Prisma.TransactionClient, orderId: string) {
        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: { lines: { include: { lotPosition: true } } },
        })
        if (order.kind !== SalesOrderKind.LOT || order.status !== SalesOrderStatus.CONFIRMED) return null
        const positions = order.lines.map((line) => line.lotPosition).filter(Boolean)
        if (!positions.length) return null
        const complete = positions.every((position) =>
            new Prisma.Decimal(position!.issuedQty)
                .plus(position!.adjustedQty)
                .greaterThanOrEqualTo(position!.totalQty),
        )
        if (!complete) return null
        await tx.salesOrder.update({
            where: { id: orderId },
            data: { status: SalesOrderStatus.COMPLETED, version: { increment: 1 } },
        })
        return SalesOrderStatus.COMPLETED
    }

    // ===== Điều chỉnh giảm đơn lô (append-only, chỉ có hiệu lực sau khi duyệt) =====

    async requestAdjustment(dto: CreateLotAdjustmentDto, actor: ScopedActor) {
        const reason = dto.reason?.trim()
        if (!reason) {
            throw new BadRequestException({
                code: 'LOT_ADJUSTMENT_REASON_REQUIRED',
                message: 'Điều chỉnh giảm đơn lô bắt buộc nhập lý do.',
            })
        }
        const adjustment = await this.prisma.$transaction(async (tx) => {
            const balance = await this.balanceForLine(tx, dto.salesOrderLineId)
            if (!balance) throw new NotFoundException('SALES_LOT_POSITION_NOT_FOUND')
            const qty = new Prisma.Decimal(dto.qty)
            if (qty.greaterThan(balance.remainingQty)) {
                throw new BadRequestException({
                    code: 'LOT_ADJUSTMENT_EXCEEDS_REMAINING',
                    message: `Điều chỉnh ${qty} vượt số còn có thể rút (${balance.remainingQty}).`,
                })
            }
            const created = await tx.salesLotAdjustment.create({
                data: {
                    salesLotPositionId: balance.lotPositionId,
                    qty,
                    reason,
                    requestedById: actor.userId,
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: dto.salesOrderLineId,
                eventType: 'LOT_ADJUSTMENT_REQUEST',
                actorId: actor.userId,
                reason,
                metadata: { adjustmentId: created.id, qty: qty.toString() },
            })
            return created
        })
        return adjustment
    }

    async decideAdjustment(
        adjustmentId: string,
        decision: 'APPROVED' | 'REJECTED',
        dto: DecideLotAdjustmentDto,
        actor: ScopedActor,
    ) {
        if (decision === 'REJECTED' && !dto.decisionNote?.trim()) {
            throw new BadRequestException({
                code: 'DECISION_NOTE_REQUIRED',
                message: 'Từ chối điều chỉnh bắt buộc nhập lý do.',
            })
        }
        return this.prisma.$transaction(async (tx) => {
            const adjustment = await tx.salesLotAdjustment.findUnique({
                where: { id: adjustmentId },
                include: { position: true },
            })
            if (!adjustment) throw new NotFoundException('SALES_LOT_ADJUSTMENT_NOT_FOUND')
            if (adjustment.status !== SalesApprovalStatus.PENDING) {
                throw new BadRequestException({
                    code: 'LOT_ADJUSTMENT_NOT_PENDING',
                    message: 'Điều chỉnh này đã được xử lý.',
                })
            }

            await tx.salesLotAdjustment.update({
                where: { id: adjustmentId },
                data: {
                    status:
                        decision === 'APPROVED'
                            ? SalesApprovalStatus.APPROVED
                            : SalesApprovalStatus.REJECTED,
                    decidedById: actor.userId,
                    decidedAt: new Date(),
                    decisionNote: dto.decisionNote?.trim() || null,
                },
            })

            if (decision === 'APPROVED') {
                // adjustedQty is a projection of approved adjustments only.
                const balance = await this.balanceForLine(tx, adjustment.position.salesOrderLineId)
                if (!balance || new Prisma.Decimal(adjustment.qty).greaterThan(balance.remainingQty)) {
                    throw new BadRequestException({
                        code: 'LOT_ADJUSTMENT_EXCEEDS_REMAINING',
                        message: 'Số còn có thể rút đã thay đổi, điều chỉnh không còn hợp lệ.',
                    })
                }
                await tx.salesLotPosition.update({
                    where: { id: adjustment.salesLotPositionId },
                    data: {
                        adjustedQty: { increment: adjustment.qty },
                        version: { increment: 1 },
                    },
                })
                const orderLine = await tx.salesOrderLine.findUniqueOrThrow({
                    where: { id: adjustment.position.salesOrderLineId },
                    select: { salesOrderId: true },
                })
                await this.closeIfComplete(tx, orderLine.salesOrderId)
            }

            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: adjustment.position.salesOrderLineId,
                eventType: `LOT_ADJUSTMENT_${decision}`,
                actorId: actor.userId,
                reason: dto.decisionNote?.trim() ?? null,
                metadata: { adjustmentId, qty: adjustment.qty.toString() },
            })

            return tx.salesLotAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } })
        })
    }
}
