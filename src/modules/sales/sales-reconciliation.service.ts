import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    SalesDeliveryStatus,
    SalesReconciliationStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { SalesOrderStatusService } from './sales-order-status.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import { ResolveReconciliationLineDto, UpdateReconciliationLineDto } from './dto/sales-reconciliation.dto'

/** The commercial document a reconciliation belongs to — exactly one of the two. */
export type SalesReconciliationTarget = {
    salesOrderId?: string
    withdrawalRequestId?: string
}

const detailInclude = Prisma.validator<Prisma.SalesReconciliationInclude>()({
    salesOrder: {
        select: {
            id: true,
            orderNo: true,
            status: true,
            customer: { select: { id: true, code: true, name: true } },
        },
    },
    lines: {
        orderBy: { createdAt: 'asc' },
        include: {
            orderLine: {
                select: {
                    id: true,
                    lineNo: true,
                    product: { select: { id: true, code: true, name: true, uom: true } },
                },
            },
            delivery: {
                select: {
                    id: true,
                    deliveryNo: true,
                    status: true,
                    issueDocNo: true,
                    warehouse: { select: { id: true, code: true, name: true } },
                },
            },
        },
    },
})

/**
 * Compares ordered / planned / warehouse-confirmed / document / actual quantities per line
 * and warehouse (spec v1.2 §3.6, §7). A variance is never silently accepted: it must be
 * resolved with a reason, and a large one needs exception authority.
 */
@Injectable()
export class SalesReconciliationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly events: SalesWorkflowEventsService,
        private readonly orderStatus: SalesOrderStatusService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    /** Quantity difference below this counts as measurement noise and passes as MATCHED. */
    private tolerance() {
        return new Prisma.Decimal(process.env.SALES_RECONCILIATION_TOLERANCE ?? '0')
    }

    /** Above this, only someone with exception authority may resolve the variance. */
    private escalationThreshold() {
        return new Prisma.Decimal(process.env.SALES_RECONCILIATION_ESCALATION_QTY ?? '100')
    }

    private lineStatus(orderedQty: Prisma.Decimal, actualQty: Prisma.Decimal) {
        return actualQty.minus(orderedQty).abs().greaterThan(this.tolerance())
            ? SalesReconciliationStatus.VARIANCE
            : SalesReconciliationStatus.MATCHED
    }

    /**
     * Rebuilds the reconciliation from the target's posted deliveries. Called right after a
     * warehouse confirms an issue and after a correction, inside the same transaction.
     *
     * Target is the commercial document: a SINGLE order as a whole, or one LOT draw.
     */
    async syncForTarget(
        tx: Prisma.TransactionClient,
        target: SalesReconciliationTarget,
        actorId?: string | null,
    ) {
        const deliveries = await tx.salesDelivery.findMany({
            where: {
                status: SalesDeliveryStatus.POSTED,
                ...(target.withdrawalRequestId
                    ? { withdrawalRequestId: target.withdrawalRequestId }
                    : { salesOrderId: target.salesOrderId, withdrawalRequestId: null }),
            },
            include: { lines: true },
        })
        const postedLines = deliveries.flatMap((delivery) =>
            delivery.lines.map((line) => ({ delivery, line })),
        )
        if (!postedLines.length) return null

        // What was committed: the order line for a SINGLE, the requested draw for a LOT.
        const orderedByLine = new Map<string, Prisma.Decimal>()
        if (target.withdrawalRequestId) {
            const requestLines = await tx.salesLotWithdrawalRequestLine.findMany({
                where: { requestId: target.withdrawalRequestId },
                select: { salesOrderLineId: true, requestedQty: true },
            })
            for (const line of requestLines) {
                if (line.salesOrderLineId) orderedByLine.set(line.salesOrderLineId, line.requestedQty)
            }
        } else {
            const orderLines = await tx.salesOrderLine.findMany({
                where: { salesOrderId: target.salesOrderId },
                select: { id: true, orderedActualQty: true },
            })
            for (const line of orderLines) orderedByLine.set(line.id, line.orderedActualQty)
        }

        const where = target.withdrawalRequestId
            ? { withdrawalRequestId: target.withdrawalRequestId }
            : { salesOrderId: target.salesOrderId! }
        const existing = await tx.salesReconciliation.findFirst({ where, include: { lines: true } })
        const reconciliation =
            existing ??
            (await tx.salesReconciliation.create({
                data: {
                    salesOrderId: target.withdrawalRequestId ? null : target.salesOrderId!,
                    withdrawalRequestId: target.withdrawalRequestId ?? null,
                    status: SalesReconciliationStatus.OPEN,
                },
                include: { lines: true },
            }))

        for (const { delivery, line } of postedLines) {
            if (reconciliation.lines.some((row) => row.salesDeliveryLineId === line.id)) continue
            const orderedQty = new Prisma.Decimal(orderedByLine.get(line.salesOrderLineId) ?? 0)
            const actualQty = new Prisma.Decimal(line.actualQty ?? 0)
            const created = await tx.salesReconciliationLine.create({
                data: {
                    reconciliationId: reconciliation.id,
                    salesOrderLineId: line.salesOrderLineId,
                    salesDeliveryId: delivery.id,
                    salesDeliveryLineId: line.id,
                    warehouseId: delivery.warehouseId,
                    orderedQty,
                    plannedQty: line.plannedActualQty,
                    warehouseConfirmedQty: actualQty,
                    actualQty,
                    v15Qty: line.v15Qty,
                    status: this.lineStatus(orderedQty, actualQty),
                },
            })

            // A revision's line replaces the one from the delivery it corrects, which keeps
            // its history but drops out of the aggregate.
            if (delivery.revisionOfId) {
                await tx.salesReconciliationLine.updateMany({
                    where: {
                        reconciliationId: reconciliation.id,
                        salesDeliveryId: delivery.revisionOfId,
                        salesOrderLineId: line.salesOrderLineId,
                        supersededById: null,
                    },
                    data: { supersededById: created.id },
                })
            }
        }

        return this.recomputeHeader(tx, reconciliation.id, actorId)
    }

    /** Effective lines are those not superseded and whose delivery is still valid. */
    private async effectiveLines(tx: Prisma.TransactionClient, reconciliationId: string) {
        return tx.salesReconciliationLine.findMany({
            where: {
                reconciliationId,
                supersededById: null,
                delivery: { status: { not: SalesDeliveryStatus.VOIDED } },
            },
        })
    }

    private async recomputeHeader(
        tx: Prisma.TransactionClient,
        reconciliationId: string,
        actorId?: string | null,
    ) {
        const lines = await this.effectiveLines(tx, reconciliationId)
        let status: SalesReconciliationStatus
        if (!lines.length) {
            status = SalesReconciliationStatus.OPEN
        } else if (lines.every((line) => line.status === SalesReconciliationStatus.MATCHED)) {
            status = SalesReconciliationStatus.MATCHED
        } else if (lines.some((line) => line.status === SalesReconciliationStatus.VARIANCE)) {
            status = SalesReconciliationStatus.VARIANCE
        } else if (lines.some((line) => line.status === SalesReconciliationStatus.RESOLVED)) {
            status = SalesReconciliationStatus.RESOLVED
        } else {
            status = SalesReconciliationStatus.OPEN
        }

        const current = await tx.salesReconciliation.findUniqueOrThrow({ where: { id: reconciliationId } })
        if (current.status !== status) {
            await tx.salesReconciliation.update({
                where: { id: reconciliationId },
                data: {
                    status,
                    resolvedById:
                        status === SalesReconciliationStatus.RESOLVED ? (actorId ?? null) : null,
                    resolvedAt: status === SalesReconciliationStatus.RESOLVED ? new Date() : null,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_RECONCILIATION',
                entityId: reconciliationId,
                eventType: 'STATUS',
                fromStatus: current.status,
                toStatus: status,
                actorId: actorId ?? null,
                version: current.version + 1,
            })
        }
        return { reconciliationId, status, version: current.version, lines }
    }

    private targetWhere(target: SalesReconciliationTarget) {
        return target.withdrawalRequestId
            ? { withdrawalRequestId: target.withdrawalRequestId }
            : { salesOrderId: target.salesOrderId! }
    }

    /** True when nothing blocks invoicing (spec v1.2 §4.1). */
    async isSettled(tx: Prisma.TransactionClient, target: SalesReconciliationTarget) {
        const reconciliation = await tx.salesReconciliation.findFirst({
            where: this.targetWhere(target),
            select: { id: true },
        })
        if (!reconciliation) return false
        const lines = await this.effectiveLines(tx, reconciliation.id)
        if (!lines.length) return false
        return lines.every(
            (line) =>
                line.status === SalesReconciliationStatus.MATCHED ||
                line.status === SalesReconciliationStatus.RESOLVED,
        )
    }

    /** Raised once per sync when at least one line is off. */
    async notifyVariance(
        tx: Prisma.TransactionClient,
        target: SalesReconciliationTarget,
        actorId?: string | null,
    ) {
        const reconciliation = await tx.salesReconciliation.findFirst({
            where: this.targetWhere(target),
            include: {
                salesOrder: {
                    select: {
                        orderNo: true,
                        createdById: true,
                        submittedById: true,
                        customer: { select: { name: true } },
                    },
                },
                withdrawalRequest: {
                    select: {
                        requestNo: true,
                        createdById: true,
                        submittedById: true,
                        customer: { select: { name: true } },
                    },
                },
            },
        })
        if (!reconciliation || reconciliation.status !== SalesReconciliationStatus.VARIANCE) return
        const source = reconciliation.salesOrder
            ? {
                  docNo: reconciliation.salesOrder.orderNo,
                  customerName: reconciliation.salesOrder.customer.name,
                  owners: [reconciliation.salesOrder.createdById, reconciliation.salesOrder.submittedById],
              }
            : {
                  docNo: reconciliation.withdrawalRequest!.requestNo,
                  customerName: reconciliation.withdrawalRequest!.customer.name,
                  owners: [
                      reconciliation.withdrawalRequest!.createdById,
                      reconciliation.withdrawalRequest!.submittedById,
                  ],
              }

        const lines = await this.effectiveLines(tx, reconciliation.id)
        const variances = lines.filter((line) => line.status === SalesReconciliationStatus.VARIANCE)
        const escalated = variances.some((line) =>
            line.actualQty.minus(line.orderedQty).abs().greaterThan(this.escalationThreshold()),
        )

        await this.notificationOutbox.emit(
            {
                eventType: SALES_NOTIFICATION_EVENTS.RECONCILIATION_VARIANCE,
                aggregateType: 'SALES_RECONCILIATION',
                aggregateId: reconciliation.id,
                dedupeKey: `${SALES_NOTIFICATION_EVENTS.RECONCILIATION_VARIANCE}:${reconciliation.id}:v${reconciliation.version}`,
                payload: {
                    entityType: 'SALES_RECONCILIATION',
                    entityId: reconciliation.id,
                    workItemSourceType: 'SALES_RECONCILIATION',
                    workItemSourceId: reconciliation.id,
                    actionRequired: true,
                    sourceVersion: reconciliation.version,
                    orderNo: source.docNo,
                    customerName: source.customerName,
                    varianceSummary: variances
                        .map(
                            (line) =>
                                `chênh ${line.actualQty.minus(line.orderedQty).toString()} (đặt ${line.orderedQty}, xuất ${line.actualQty})`,
                        )
                        .join('; '),
                    escalated,
                    recipientUserIds: source.owners.filter((value): value is string => !!value),
                    recipientPermissionCodes: escalated
                        ? [PERMISSIONS.sales.reconcile, PERMISSIONS.sales.approveException]
                        : [PERMISSIONS.sales.reconcile],
                    excludeUserIds: actorId ? [actorId] : [],
                },
            },
            tx,
        )
    }

    async detail(target: SalesReconciliationTarget) {
        const reconciliation = await this.prisma.salesReconciliation.findFirst({
            where: this.targetWhere(target),
            include: detailInclude,
        })
        if (!reconciliation) throw new NotFoundException('SALES_RECONCILIATION_NOT_FOUND')
        return {
            ...reconciliation,
            lines: reconciliation.lines.map((line) => ({
                ...line,
                varianceQty: line.actualQty.minus(line.orderedQty).toString(),
                isEffective: line.supersededById === null && line.delivery.status !== 'VOIDED',
            })),
        }
    }

    /** Warehouse/sales fill in the issue-document quantity and explain the gap. */
    async updateLine(lineId: string, dto: UpdateReconciliationLineDto, actor: ScopedActor) {
        const target = await this.prisma.$transaction(async (tx) => {
            const line = await tx.salesReconciliationLine.findUnique({
                where: { id: lineId },
                include: {
                    reconciliation: {
                        select: { id: true, salesOrderId: true, withdrawalRequestId: true },
                    },
                },
            })
            if (!line) throw new NotFoundException('SALES_RECONCILIATION_LINE_NOT_FOUND')
            if (line.supersededById) {
                throw new BadRequestException({
                    code: 'RECONCILIATION_LINE_SUPERSEDED',
                    message: 'Dòng đối soát này đã bị thay thế bởi chứng từ điều chỉnh.',
                })
            }
            if (line.status === SalesReconciliationStatus.RESOLVED) {
                throw new BadRequestException({
                    code: 'RECONCILIATION_LINE_RESOLVED',
                    message: 'Dòng đối soát đã xử lý xong, không sửa được nữa.',
                })
            }
            await tx.salesReconciliationLine.update({
                where: { id: lineId },
                data: {
                    docQty: dto.docQty == null ? line.docQty : new Prisma.Decimal(dto.docQty),
                    varianceNote: dto.varianceNote?.trim() ?? line.varianceNote,
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_RECONCILIATION',
                entityId: line.reconciliation.id,
                eventType: 'UPDATE_LINE',
                actorId: actor.userId,
                reason: dto.varianceNote?.trim() ?? null,
                metadata: { lineId, docQty: dto.docQty ?? null },
            })
            return {
                salesOrderId: line.reconciliation.salesOrderId ?? undefined,
                withdrawalRequestId: line.reconciliation.withdrawalRequestId ?? undefined,
            }
        })
        return this.detail(target)
    }

    /**
     * Accepts a variance with a reason. Stock and cost are never edited here — a wrong
     * quantity must be corrected by voiding the delivery and posting a revision (§9).
     */
    async resolveLine(lineId: string, dto: ResolveReconciliationLineDto, actor: ScopedActor) {
        const note = dto.varianceNote?.trim()
        if (!note) {
            throw new BadRequestException({
                code: 'RECONCILIATION_NOTE_REQUIRED',
                message: 'Xử lý chênh lệch bắt buộc nhập nội dung giải trình.',
            })
        }

        const target = await this.prisma.$transaction(async (tx) => {
            const line = await tx.salesReconciliationLine.findUnique({
                where: { id: lineId },
                include: {
                    reconciliation: {
                        select: { id: true, salesOrderId: true, withdrawalRequestId: true },
                    },
                },
            })
            if (!line) throw new NotFoundException('SALES_RECONCILIATION_LINE_NOT_FOUND')
            if (line.supersededById) {
                throw new BadRequestException({
                    code: 'RECONCILIATION_LINE_SUPERSEDED',
                    message: 'Dòng đối soát này đã bị thay thế bởi chứng từ điều chỉnh.',
                })
            }
            if (line.status !== SalesReconciliationStatus.VARIANCE) {
                throw new BadRequestException({
                    code: 'RECONCILIATION_LINE_NOT_VARIANCE',
                    message: 'Chỉ xử lý được dòng đang có chênh lệch.',
                })
            }

            // Large gaps need exception authority — this is the "quản lý duyệt nếu cần" step.
            const variance = line.actualQty.minus(line.orderedQty).abs()
            const permissions = new Set(actor.permissions ?? [])
            if (
                variance.greaterThan(this.escalationThreshold()) &&
                !permissions.has('system.rbac.admin') &&
                !permissions.has(PERMISSIONS.sales.approveException)
            ) {
                throw new ForbiddenException({
                    code: 'RECONCILIATION_ESCALATION_REQUIRED',
                    message: `Chênh lệch ${variance.toString()} vượt ngưỡng — cần người có quyền duyệt ngoại lệ xử lý.`,
                })
            }

            await tx.salesReconciliationLine.update({
                where: { id: lineId },
                data: {
                    status: SalesReconciliationStatus.RESOLVED,
                    varianceNote: note,
                    resolvedById: actor.userId,
                    resolvedAt: new Date(),
                    docQty: dto.docQty == null ? line.docQty : new Prisma.Decimal(dto.docQty),
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_RECONCILIATION',
                entityId: line.reconciliation.id,
                eventType: 'RESOLVE_LINE',
                fromStatus: SalesReconciliationStatus.VARIANCE,
                toStatus: SalesReconciliationStatus.RESOLVED,
                actorId: actor.userId,
                reason: note,
                metadata: { lineId, varianceQty: variance.toString() },
            })

            const header = await this.recomputeHeader(tx, line.reconciliation.id, actor.userId)
            // Settling the last variance is what unblocks invoicing (spec v1.2 §4.1).
            if (line.reconciliation.salesOrderId) {
                await this.orderStatus.recompute(tx, line.reconciliation.salesOrderId)
            }
            if (
                header.status === SalesReconciliationStatus.RESOLVED ||
                header.status === SalesReconciliationStatus.MATCHED
            ) {
                const source = line.reconciliation.salesOrderId
                    ? await tx.salesOrder.findUniqueOrThrow({
                          where: { id: line.reconciliation.salesOrderId },
                          select: {
                              orderNo: true,
                              createdById: true,
                              submittedById: true,
                              customer: { select: { name: true } },
                          },
                      })
                    : await tx.salesLotWithdrawalRequest.findUniqueOrThrow({
                          where: { id: line.reconciliation.withdrawalRequestId! },
                          select: {
                              requestNo: true,
                              createdById: true,
                              submittedById: true,
                              customer: { select: { name: true } },
                          },
                      })
                const order = {
                    orderNo: 'orderNo' in source ? source.orderNo : source.requestNo,
                    createdById: source.createdById,
                    submittedById: source.submittedById,
                    customer: source.customer,
                }
                await this.notificationOutbox.emit(
                    {
                        eventType: SALES_NOTIFICATION_EVENTS.RECONCILIATION_RESOLVED,
                        aggregateType: 'SALES_RECONCILIATION',
                        aggregateId: line.reconciliation.id,
                        dedupeKey: `${SALES_NOTIFICATION_EVENTS.RECONCILIATION_RESOLVED}:${line.reconciliation.id}:v${header.version + 1}`,
                        payload: {
                            entityType: 'SALES_RECONCILIATION',
                            entityId: line.reconciliation.id,
                            resolvedActions: ['RESOLVE_SALES_RECONCILIATION'],
                            workItemSourceType: 'SALES_RECONCILIATION',
                            workItemSourceId: line.reconciliation.id,
                            sourceVersion: header.version + 1,
                            orderNo: order.orderNo,
                            customerName: order.customer.name,
                            recipientUserIds: [order.createdById, order.submittedById].filter(
                                (value): value is string => !!value,
                            ),
                            recipientPermissionCodes: [PERMISSIONS.sales.invoiceIssue],
                            excludeUserIds: actor.userId ? [actor.userId] : [],
                        },
                    },
                    tx,
                )
            }
            return {
                salesOrderId: line.reconciliation.salesOrderId ?? undefined,
                withdrawalRequestId: line.reconciliation.withdrawalRequestId ?? undefined,
            }
        })
        return this.detail(target)
    }
}
