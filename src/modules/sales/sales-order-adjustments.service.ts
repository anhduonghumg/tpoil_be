import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    SalesApprovalStatus,
    SalesInvoiceStatus,
    SalesOrderStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SalesActor } from './sales-order-workflow.service'
import { SalesReservationService } from './sales-reservation.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import {
    CreateSalesOrderAdjustmentDto,
    DecideSalesOrderAdjustmentDto,
} from './dto/sales-order-adjustment.dto'

const adjustmentInclude = Prisma.validator<Prisma.SalesOrderAdjustmentInclude>()({
    salesOrder: {
        select: {
            id: true,
            orderNo: true,
            kind: true,
            status: true,
            customer: { select: { id: true, code: true, name: true } },
        },
    },
    lines: {
        orderBy: { orderLine: { lineNo: 'asc' } },
        include: {
            orderLine: {
                select: {
                    id: true,
                    lineNo: true,
                    product: { select: { id: true, code: true, name: true, uom: true } },
                },
            },
        },
    },
})

@Injectable()
export class SalesOrderAdjustmentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly reservations: SalesReservationService,
        private readonly events: SalesWorkflowEventsService,
    ) {}

    private async nextNo(tx: Prisma.TransactionClient, date: Date) {
        const period = `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}`
        const sequence = await tx.documentSequence.upsert({
            where: { moduleCode_period: { moduleCode: 'SALES_ORDER_ADJUSTMENT', period } },
            create: { moduleCode: 'SALES_ORDER_ADJUSTMENT', period, currentNo: 1 },
            update: { currentNo: { increment: 1 } },
        })
        return `DCBH${period}${String(sequence.currentNo).padStart(4, '0')}`
    }

    list(salesOrderId?: string) {
        return this.prisma.salesOrderAdjustment.findMany({
            where: { salesOrderId: salesOrderId || undefined },
            include: adjustmentInclude,
            orderBy: { createdAt: 'desc' },
        })
    }

    async detail(id: string) {
        const adjustment = await this.prisma.salesOrderAdjustment.findUnique({
            where: { id },
            include: adjustmentInclude,
        })
        if (!adjustment) throw new NotFoundException('SALES_ORDER_ADJUSTMENT_NOT_FOUND')
        return adjustment
    }

    async create(dto: CreateSalesOrderAdjustmentDto, actor: SalesActor) {
        const reason = dto.reason?.trim()
        if (!reason) {
            throw new BadRequestException({
                code: 'SALES_ADJUSTMENT_REASON_REQUIRED',
                message: 'Đơn điều chỉnh bắt buộc nhập lý do.',
            })
        }
        const uniqueLineIds = [...new Set(dto.lines.map((line) => line.salesOrderLineId))]
        if (uniqueLineIds.length !== dto.lines.length) {
            throw new BadRequestException('SALES_ADJUSTMENT_DUPLICATE_LINE')
        }

        const id = await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id: dto.salesOrderId },
                include: { lines: { where: { id: { in: uniqueLineIds } } } },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            if (!order.approvedAt || ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'CANCELLED'].includes(order.status)) {
                throw new BadRequestException({
                    code: 'SALES_ADJUSTMENT_ORDER_NOT_APPROVED',
                    message: 'Chỉ tạo đơn điều chỉnh cho đơn bán đã được duyệt và còn hiệu lực.',
                })
            }
            if (order.lines.length !== uniqueLineIds.length) {
                throw new BadRequestException('SALES_ADJUSTMENT_LINE_NOT_IN_ORDER')
            }
            const pending = await tx.salesOrderAdjustment.findFirst({
                where: { salesOrderId: order.id, status: SalesApprovalStatus.PENDING },
                select: { adjustmentNo: true },
            })
            if (pending) {
                throw new ConflictException({
                    code: 'SALES_ADJUSTMENT_ALREADY_PENDING',
                    message: `Đơn đang có phiếu điều chỉnh ${pending.adjustmentNo} chờ duyệt.`,
                })
            }

            const inputByLineId = new Map(dto.lines.map((line) => [line.salesOrderLineId, line]))
            const lines = order.lines.map((orderLine) => {
                const input = inputByLineId.get(orderLine.id)!
                const previousQty = new Prisma.Decimal(orderLine.orderedActualQty)
                const adjustedQty = new Prisma.Decimal(input.adjustedQty ?? previousQty)
                const previousUnitPrice = new Prisma.Decimal(orderLine.unitPrice)
                const adjustedUnitPrice = new Prisma.Decimal(
                    input.adjustedUnitPrice ?? previousUnitPrice,
                )
                const quantityChanged = !adjustedQty.equals(previousQty)
                const unitPriceChanged = !adjustedUnitPrice.equals(previousUnitPrice)
                if (!quantityChanged && !unitPriceChanged) {
                    throw new BadRequestException({
                        code: 'SALES_ADJUSTMENT_LINE_UNCHANGED',
                        message: `Dòng ${orderLine.lineNo} chưa thay đổi số lượng hoặc đơn giá.`,
                    })
                }
                return {
                    salesOrderLineId: orderLine.id,
                    previousQty,
                    adjustedQty,
                    previousUnitPrice,
                    adjustedUnitPrice,
                    quantityChanged,
                    unitPriceChanged,
                }
            })
            const created = await tx.salesOrderAdjustment.create({
                data: {
                    adjustmentNo: await this.nextNo(tx, new Date()),
                    salesOrderId: order.id,
                    reason,
                    requestedById: actor.userId,
                    lines: { create: lines },
                },
                select: { id: true, adjustmentNo: true },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER_ADJUSTMENT',
                entityId: created.id,
                eventType: 'REQUEST',
                toStatus: SalesApprovalStatus.PENDING,
                actorId: actor.userId,
                metadata: { salesOrderId: order.id, adjustmentNo: created.adjustmentNo },
            })
            return created.id
        })
        return this.detail(id)
    }

    async approve(id: string, dto: DecideSalesOrderAdjustmentDto, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const adjustment = await tx.salesOrderAdjustment.findUnique({
                where: { id },
                include: {
                    lines: { include: { orderLine: true } },
                    salesOrder: {
                        include: {
                            deliveries: {
                                where: { status: 'POSTED' },
                                include: { lines: true },
                            },
                            withdrawals: {
                                include: {
                                    deliveries: {
                                        where: { status: 'POSTED' },
                                        include: { lines: true },
                                    },
                                    invoices: { select: { id: true, status: true } },
                                },
                            },
                            invoices: { select: { id: true, status: true } },
                        },
                    },
                },
            })
            if (!adjustment) throw new NotFoundException('SALES_ORDER_ADJUSTMENT_NOT_FOUND')
            if (adjustment.status !== SalesApprovalStatus.PENDING) {
                throw new ConflictException('SALES_ORDER_ADJUSTMENT_NOT_PENDING')
            }

            const postedQtyByLine = new Map<string, Prisma.Decimal>()
            const postedDeliveries = [
                ...adjustment.salesOrder.deliveries,
                ...adjustment.salesOrder.withdrawals.flatMap((withdrawal) => withdrawal.deliveries),
            ]
            for (const delivery of postedDeliveries) {
                for (const line of delivery.lines) {
                    postedQtyByLine.set(
                        line.salesOrderLineId,
                        (postedQtyByLine.get(line.salesOrderLineId) ?? new Prisma.Decimal(0)).plus(
                            line.actualQty ?? 0,
                        ),
                    )
                }
            }
            const invoices = [
                ...adjustment.salesOrder.invoices,
                ...adjustment.salesOrder.withdrawals.flatMap((withdrawal) => withdrawal.invoices),
            ]
            const requiresInvoiceCorrection = invoices.some(
                (invoice) => invoice.status === SalesInvoiceStatus.ISSUED,
            )
            let requiresWarehouseCorrection = false
            let changedReservationQty = false

            for (const line of adjustment.lines) {
                const postedQty = postedQtyByLine.get(line.salesOrderLineId) ?? new Prisma.Decimal(0)
                const quantityNeedsWarehouse = line.quantityChanged && postedQty.greaterThan(0)
                requiresWarehouseCorrection ||= quantityNeedsWarehouse

                const data: Prisma.SalesOrderLineUpdateInput = {}
                if (line.unitPriceChanged) data.unitPrice = line.adjustedUnitPrice
                if (line.quantityChanged && !quantityNeedsWarehouse) {
                    const oldQty = new Prisma.Decimal(line.orderLine.orderedActualQty)
                    data.orderedActualQty = line.adjustedQty
                    data.orderedV15Qty = line.orderLine.orderedV15Qty
                        ? new Prisma.Decimal(line.orderLine.orderedV15Qty)
                              .mul(line.adjustedQty)
                              .div(oldQty)
                        : null
                    await this.reservations.resizeOrderLine(tx, {
                        salesOrderLineId: line.salesOrderLineId,
                        targetQty: new Prisma.Decimal(line.adjustedQty),
                        adjustmentId: adjustment.id,
                        actor,
                    })
                    await tx.salesLotPosition.updateMany({
                        where: { salesOrderLineId: line.salesOrderLineId },
                        data: { totalQty: line.adjustedQty, version: { increment: 1 } },
                    })
                    changedReservationQty = true
                }
                if (Object.keys(data).length) {
                    await tx.salesOrderLine.update({ where: { id: line.salesOrderLineId }, data })
                }
            }

            // Draft invoices are only snapshots. Remove them from the live flow so the next
            // open recreates prices/quantities from the approved correction.
            await tx.salesInvoice.updateMany({
                where: {
                    status: SalesInvoiceStatus.DRAFT,
                    OR: [
                        { salesOrderId: adjustment.salesOrderId },
                        { withdrawalRequest: { salesOrderId: adjustment.salesOrderId } },
                    ],
                },
                data: { status: SalesInvoiceStatus.CANCELLED, version: { increment: 1 } },
            })

            if (changedReservationQty) {
                const outcome = await this.reservations.reserveOrder(tx, adjustment.salesOrderId, actor)
                await tx.salesOrder.update({
                    where: { id: adjustment.salesOrderId },
                    data: {
                        status: outcome.fullyReserved
                            ? SalesOrderStatus.RESERVED
                            : outcome.lines.some((line) => new Prisma.Decimal(line.reservedQty).greaterThan(0))
                              ? SalesOrderStatus.PARTIALLY_RESERVED
                              : SalesOrderStatus.AWAITING_STOCK,
                        version: { increment: 1 },
                    },
                })
            }

            const now = new Date()
            await tx.salesOrderAdjustment.update({
                where: { id: adjustment.id },
                data: {
                    status: SalesApprovalStatus.APPROVED,
                    requiresWarehouseCorrection,
                    requiresInvoiceCorrection,
                    decidedById: actor.userId,
                    decidedAt: now,
                    decisionNote: dto.note?.trim() || null,
                    appliedAt:
                        requiresWarehouseCorrection || requiresInvoiceCorrection ? null : now,
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER_ADJUSTMENT',
                entityId: adjustment.id,
                eventType: 'APPROVE',
                fromStatus: SalesApprovalStatus.PENDING,
                toStatus: SalesApprovalStatus.APPROVED,
                actorId: actor.userId,
                metadata: { requiresWarehouseCorrection, requiresInvoiceCorrection },
            })
        })
        return this.detail(id)
    }

    async reject(id: string, dto: DecideSalesOrderAdjustmentDto, actor: SalesActor) {
        const note = dto.note?.trim()
        if (!note) {
            throw new BadRequestException({
                code: 'SALES_ADJUSTMENT_REJECTION_REASON_REQUIRED',
                message: 'Từ chối đơn điều chỉnh bắt buộc nhập lý do.',
            })
        }
        await this.prisma.$transaction(async (tx) => {
            const updated = await tx.salesOrderAdjustment.updateMany({
                where: { id, status: SalesApprovalStatus.PENDING },
                data: {
                    status: SalesApprovalStatus.REJECTED,
                    decidedById: actor.userId,
                    decidedAt: new Date(),
                    decisionNote: note,
                },
            })
            if (!updated.count) throw new ConflictException('SALES_ORDER_ADJUSTMENT_NOT_PENDING')
            await this.events.record(tx, {
                entityType: 'SALES_ORDER_ADJUSTMENT',
                entityId: id,
                eventType: 'REJECT',
                fromStatus: SalesApprovalStatus.PENDING,
                toStatus: SalesApprovalStatus.REJECTED,
                actorId: actor.userId,
                reason: note,
            })
        })
        return this.detail(id)
    }
}
