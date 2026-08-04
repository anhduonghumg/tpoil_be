import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    MasterStatus,
    PaymentTermType,
    Prisma,
    SalesApprovalStatus,
    SalesApprovalType,
    SalesOrderKind,
    SalesOrderStatus,
} from '@prisma/client'
import { createHash } from 'crypto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesOrderChecksService, SalesOrderCheckResult } from './sales-order-checks.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { SalesOrdersService } from './sales-orders.service'
import { SalesReservationService } from './sales-reservation.service'
import { SalesDeliveriesService } from './sales-deliveries.service'
import { SalesOrderStatusService } from './sales-order-status.service'
import { SalesLotService } from './sales-lot.service'
import { CreateSalesOrderDto, UpdateSalesOrderDto } from './dto/sales-order.dto'
import { ScopeType } from '@prisma/client'

export type SalesActor = {
    userId: string | null
    permissions?: string[]
    scopes?: Array<{ type: ScopeType; scopeId?: string | null }>
}

export const APPROVAL_TYPE_LABELS: Record<SalesApprovalType, string> = {
    PRICE: 'giá/chiết khấu',
    CREDIT: 'công nợ',
    EXCEPTION: 'ngoại lệ',
}

export const APPROVAL_TYPE_PERMISSIONS: Record<SalesApprovalType, string> = {
    PRICE: PERMISSIONS.sales.approvePrice,
    CREDIT: PERMISSIONS.sales.approveCredit,
    EXCEPTION: PERMISSIONS.sales.approveException,
}

const INTERNAL_KINDS: SalesOrderKind[] = [SalesOrderKind.SINGLE, SalesOrderKind.LOT]

/** Draft lifecycle + submit/recall/cancel for the internal SINGLE/LOT sales flow (spec v1.2 §4). */
@Injectable()
export class SalesOrderWorkflowService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly orders: SalesOrdersService,
        private readonly checks: SalesOrderChecksService,
        private readonly events: SalesWorkflowEventsService,
        private readonly reservations: SalesReservationService,
        private readonly deliveries: SalesDeliveriesService,
        private readonly orderStatus: SalesOrderStatusService,
        private readonly lots: SalesLotService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    private assertInternalKind(kind: SalesOrderKind) {
        if (!INTERNAL_KINDS.includes(kind)) {
            throw new BadRequestException({
                code: 'SALES_ORDER_KIND_NOT_INTERNAL',
                message: 'Thao tác này chỉ áp dụng cho đơn bán nội bộ (SINGLE/LOT).',
            })
        }
    }

    private linesCreateInput(dto: CreateSalesOrderDto | UpdateSalesOrderDto) {
        return (dto.lines ?? []).map((line, index) => ({
            lineNo: index + 1,
            productId: line.productId,
            issueWarehouseId: line.issueWarehouseId ?? null,
            receivingWarehouseId: line.receivingWarehouseId ?? null,
            orderedActualQty: new Prisma.Decimal(line.orderedActualQty),
            orderedV15Qty: line.orderedV15Qty == null ? null : new Prisma.Decimal(line.orderedV15Qty),
            unitPrice: new Prisma.Decimal(line.unitPrice ?? 0),
            discountAmount: new Prisma.Decimal(line.discountAmount ?? 0),
            vehiclePlate: line.vehiclePlate?.trim() || null,
            driverName: line.driverName?.trim() || null,
            taxRate: line.taxRate == null ? null : new Prisma.Decimal(line.taxRate),
            note: line.note?.trim() || null,
        }))
    }

    /**
     * Pháp nhân bán không phải dữ liệu Sale nhập — kho xuất thuộc đúng một pháp
     * nhân nên hệ thống suy ra từ đó (spec v1.2 §8.1: một đơn = một pháp nhân).
     */
    private async resolveLegalEntityId(dto: CreateSalesOrderDto) {
        const warehouseIds = [
            ...new Set((dto.lines ?? []).map((line) => line.issueWarehouseId).filter(Boolean)),
        ] as string[]
        if (!warehouseIds.length) {
            throw new BadRequestException({
                code: 'ISSUE_WAREHOUSE_REQUIRED',
                message: 'Đơn bán nội bộ phải chọn kho xuất cho từng dòng.',
            })
        }
        const warehouses = await this.prisma.warehouse.findMany({
            where: { id: { in: warehouseIds } },
            select: { id: true, legalEntityId: true },
        })
        if (warehouses.length !== warehouseIds.length) {
            throw new BadRequestException({
                code: 'ISSUE_WAREHOUSE_INVALID',
                message: 'Kho xuất không tồn tại hoặc không hoạt động.',
            })
        }
        const legalEntityIds = [...new Set(warehouses.map((row) => row.legalEntityId))]
        if (legalEntityIds.length > 1) {
            throw new BadRequestException({
                code: 'ISSUE_WAREHOUSE_LEGAL_ENTITY_MISMATCH',
                message: 'Các kho xuất thuộc nhiều pháp nhân khác nhau — phải tách thành nhiều đơn.',
            })
        }
        return legalEntityIds[0]
    }

    async createInternal(dto: CreateSalesOrderDto, actor: SalesActor) {
        const kind = dto.kind as SalesOrderKind
        this.assertInternalKind(kind)
        const legalEntityId = await this.resolveLegalEntityId(dto)
        const [customer, legalEntity] = await Promise.all([
            this.prisma.party.findUnique({
                where: { id: dto.customerPartyId },
                select: { id: true, name: true },
            }),
            this.prisma.legalEntity.findUnique({
                where: { id: legalEntityId },
                select: { id: true, baseCurrency: true },
            }),
        ])
        if (!customer) throw new BadRequestException('CUSTOMER_NOT_FOUND')
        if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_NOT_FOUND')

        const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date()
        if (Number.isNaN(orderDate.getTime())) throw new BadRequestException('ORDER_DATE_INVALID')
        if (!dto.lines?.length) throw new BadRequestException('SALES_ORDER_LINES_REQUIRED')

        const orderNo = await this.orders.generateOrderNo(dto.customerPartyId, orderDate)

        const created = await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.create({
                data: {
                    legalEntityId: legalEntity.id,
                    orderNo,
                    customerPartyId: dto.customerPartyId,
                    kind,
                    status: SalesOrderStatus.DRAFT,
                    orderDate,
                    currency: legalEntity.baseCurrency || 'VND',
                    note: dto.note?.trim() || null,
                    contractId: dto.contractId ?? null,
                    paymentTermType: (dto.paymentTermType as PaymentTermType) ?? PaymentTermType.SAME_DAY,
                    paymentTermDays: dto.paymentTermDays ?? null,
                    createdById: actor.userId,
                    lines: { create: this.linesCreateInput(dto) },
                },
                select: { id: true, status: true },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: order.id,
                eventType: 'CREATE',
                toStatus: order.status,
                actorId: actor.userId,
                metadata: { kind },
            })
            return order
        })
        return this.orders.detail(created.id)
    }

    async updateDraft(id: string, dto: UpdateSalesOrderDto, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                select: { id: true, kind: true, status: true, version: true },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (order.status !== SalesOrderStatus.DRAFT && order.status !== SalesOrderStatus.REJECTED) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_EDITABLE',
                    message: 'Chỉ sửa được đơn ở trạng thái nháp hoặc bị từ chối. Đơn đã gửi cần thu hồi trước.',
                })
            }

            const data: Prisma.SalesOrderUpdateInput = {
                status: SalesOrderStatus.DRAFT,
                version: { increment: 1 },
            }
            if (dto.orderDate !== undefined) {
                const orderDate = new Date(dto.orderDate)
                if (Number.isNaN(orderDate.getTime())) throw new BadRequestException('ORDER_DATE_INVALID')
                data.orderDate = orderDate
            }
            if (dto.note !== undefined) data.note = dto.note?.trim() || null
            if (dto.contractId !== undefined) {
                data.contract = dto.contractId
                    ? { connect: { id: dto.contractId } }
                    : { disconnect: true }
            }
            if (dto.paymentTermType !== undefined) data.paymentTermType = dto.paymentTermType as PaymentTermType
            if (dto.paymentTermDays !== undefined) data.paymentTermDays = dto.paymentTermDays ?? null

            await tx.salesOrder.update({ where: { id }, data })

            if (dto.lines) {
                if (!dto.lines.length) throw new BadRequestException('SALES_ORDER_LINES_REQUIRED')
                await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } })
                await tx.salesOrderLine.createMany({
                    data: this.linesCreateInput(dto).map((line) => ({ ...line, salesOrderId: id })),
                })
            }

            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'UPDATE',
                fromStatus: order.status,
                toStatus: SalesOrderStatus.DRAFT,
                actorId: actor.userId,
                version: order.version + 1,
            })
        })
        return this.orders.detail(id)
    }

    async deleteDraft(id: string, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                select: {
                    id: true,
                    kind: true,
                    status: true,
                    _count: { select: { approvalRequests: true } },
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (order.status !== SalesOrderStatus.DRAFT) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_DRAFT',
                    message: 'Chỉ xóa được đơn nháp.',
                })
            }
            if (order._count.approvalRequests > 0) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_HAS_HISTORY',
                    message: 'Đơn đã có lịch sử kiểm duyệt — hãy hủy đơn thay vì xóa.',
                })
            }
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'DELETE',
                fromStatus: order.status,
                actorId: actor.userId,
            })
            await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } })
            await tx.salesOrder.delete({ where: { id } })
        })
        return { success: true }
    }

    /** Snapshot of prices/terms/checks captured at submit (spec v1.2 §7.3). */
    private buildPolicySnapshot(
        order: {
            approvalCycle: number
            paymentTermType: PaymentTermType
            paymentTermDays: number | null
            contractId: string | null
            contract: { updatedAt: Date } | null
            lines: Array<{
                lineNo: number
                productId: string
                orderedActualQty: Prisma.Decimal
                unitPrice: Prisma.Decimal
                discountAmount: Prisma.Decimal
                taxRate: Prisma.Decimal | null
            }>
        },
        checkResult: SalesOrderCheckResult,
        cycle: number,
    ): Prisma.InputJsonObject {
        const payload = {
            approvalCycle: cycle,
            paymentTermType: order.paymentTermType,
            paymentTermDays: order.paymentTermDays,
            contractId: order.contractId,
            contractUpdatedAt: order.contract?.updatedAt?.toISOString() ?? null,
            lines: order.lines.map((line) => ({
                lineNo: line.lineNo,
                productId: line.productId,
                orderedActualQty: line.orderedActualQty.toString(),
                unitPrice: line.unitPrice.toString(),
                discountAmount: line.discountAmount.toString(),
                taxRate: line.taxRate?.toString() ?? null,
            })),
            checks: {
                orderValue: checkResult.orderValue,
                creditExposure: checkResult.creditExposure,
                creditLimit: checkResult.creditLimit,
                violations: checkResult.violations.map((violation) => ({
                    approvalType: violation.approvalType,
                    code: violation.code,
                    message: violation.message,
                })),
                warnings: checkResult.warnings.map((warning) => ({
                    code: warning.code,
                    message: warning.message,
                })),
            },
            capturedAt: new Date().toISOString(),
        }
        const policyHash = createHash('md5').update(JSON.stringify(payload)).digest('hex')
        return { ...payload, policyHash } as unknown as Prisma.InputJsonObject
    }

    private async validateSubmittable(
        tx: Prisma.TransactionClient,
        order: {
            id: string
            kind: SalesOrderKind
            legalEntityId: string
            lines: Array<{
                lineNo: number
                issueWarehouseId: string | null
                unitPrice: Prisma.Decimal
                vehiclePlate: string | null
                driverName: string | null
            }>
        },
    ) {
        if (!order.lines.length) throw new BadRequestException('SALES_ORDER_LINES_REQUIRED')
        for (const line of order.lines) {
            if (!line.issueWarehouseId) {
                throw new BadRequestException({
                    code: 'ISSUE_WAREHOUSE_REQUIRED',
                    message: `Dòng ${line.lineNo} chưa chọn kho xuất.`,
                })
            }
            if (!line.unitPrice.greaterThan(0)) {
                throw new BadRequestException({
                    code: 'UNIT_PRICE_REQUIRED',
                    message: `Dòng ${line.lineNo} chưa có giá bán.`,
                })
            }
            if (order.kind === SalesOrderKind.SINGLE && (!line.vehiclePlate || !line.driverName)) {
                throw new BadRequestException({
                    code: 'VEHICLE_DRIVER_REQUIRED',
                    message: `Đơn lấy 1 lần: dòng ${line.lineNo} phải có BKS và lái xe.`,
                })
            }
        }
        const warehouseIds = [...new Set(order.lines.map((line) => line.issueWarehouseId!))]
        const warehouses = await tx.warehouse.findMany({
            where: { id: { in: warehouseIds } },
            select: { id: true, name: true, status: true, legalEntityId: true },
        })
        const byId = new Map(warehouses.map((row) => [row.id, row]))
        for (const warehouseId of warehouseIds) {
            const warehouse = byId.get(warehouseId)
            if (!warehouse || warehouse.status !== MasterStatus.ACTIVE) {
                throw new BadRequestException({
                    code: 'ISSUE_WAREHOUSE_INVALID',
                    message: 'Kho xuất không tồn tại hoặc không hoạt động.',
                })
            }
            // Spec v1.2 §8.1 (review 8.1): one order = one invoice = one legal entity.
            if (warehouse.legalEntityId !== order.legalEntityId) {
                throw new BadRequestException({
                    code: 'ISSUE_WAREHOUSE_LEGAL_ENTITY_MISMATCH',
                    message: `Kho ${warehouse.name} không thuộc pháp nhân của đơn bán.`,
                })
            }
        }
    }

    async submit(id: string, actor: SalesActor) {
        const result = await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    customer: { select: { id: true, name: true } },
                    contract: { select: { updatedAt: true } },
                    lines: true,
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (order.status !== SalesOrderStatus.DRAFT) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_SUBMITTABLE',
                    message: 'Chỉ gửi kiểm duyệt được từ trạng thái nháp.',
                })
            }
            await this.validateSubmittable(tx, order)

            const cycle = order.approvalCycle + 1
            // Resubmission after recall/reject: anything still pending from older cycles is stale.
            await tx.salesApprovalRequest.updateMany({
                where: { salesOrderId: id, status: SalesApprovalStatus.PENDING },
                data: { status: SalesApprovalStatus.STALE },
            })

            const checkResult = await this.checks.run(tx, id)
            const policySnapshot = this.buildPolicySnapshot(order, checkResult, cycle)
            const violatedTypes = [...new Set(checkResult.violations.map((row) => row.approvalType))]
            const now = new Date()

            for (const type of violatedTypes) {
                await tx.salesApprovalRequest.create({
                    data: {
                        salesOrderId: id,
                        approvalCycle: cycle,
                        type,
                        status: SalesApprovalStatus.PENDING,
                        requestedById: actor.userId,
                        reasonDetail: {
                            violations: checkResult.violations
                                .filter((row) => row.approvalType === type)
                                .map((row) => ({ code: row.code, message: row.message, detail: row.detail })),
                        } as unknown as Prisma.InputJsonObject,
                    },
                })
            }

            const autoApproved = violatedTypes.length === 0
            const nextStatus = autoApproved ? SalesOrderStatus.CONFIRMED : SalesOrderStatus.PENDING_REVIEW
            await tx.salesOrder.update({
                where: { id },
                data: {
                    status: nextStatus,
                    approvalCycle: cycle,
                    submittedAt: now,
                    submittedById: actor.userId,
                    policySnapshot,
                    rejectedReason: null,
                    ...(autoApproved ? { approvedAt: now, approvedById: null } : {}),
                    version: { increment: 1 },
                },
            })

            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'SUBMIT',
                fromStatus: order.status,
                toStatus: nextStatus,
                actorId: actor.userId,
                cycle,
                metadata: {
                    violations: checkResult.violations.map((row) => row.code),
                    warnings: checkResult.warnings.map((row) => row.code),
                },
            })

            if (autoApproved) {
                await this.emitOrderApproved(tx, {
                    orderId: id,
                    orderNo: order.orderNo,
                    customerName: order.customer.name,
                    recipientUserIds: [order.createdById, actor.userId].filter(
                        (value): value is string => !!value,
                    ),
                    cycle,
                })
                await this.onApproved(tx, id, actor)
            } else {
                for (const type of violatedTypes) {
                    const reasonSummary = checkResult.violations
                        .filter((row) => row.approvalType === type)
                        .map((row) => row.message)
                        .join(' ')
                    await this.notificationOutbox.emit(
                        {
                            eventType: SALES_NOTIFICATION_EVENTS.ORDER_REVIEW_REQUESTED,
                            aggregateType: 'SALES_ORDER',
                            aggregateId: id,
                            dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_REVIEW_REQUESTED}:${id}:cycle${cycle}:${type}`,
                            payload: {
                                entityType: 'SALES_ORDER',
                                entityId: id,
                                workItemSourceType: 'SALES_ORDER_APPROVAL',
                                workItemSourceId: `${id}:${type}`,
                                actionRequired: true,
                                orderNo: order.orderNo,
                                customerName: order.customer.name,
                                approvalType: type,
                                approvalTypeLabel: APPROVAL_TYPE_LABELS[type],
                                reasonSummary,
                                cycle,
                                recipientPermissionCodes: [APPROVAL_TYPE_PERMISSIONS[type]],
                                excludeUserIds: actor.userId ? [actor.userId] : [],
                            },
                        },
                        tx,
                    )
                }
            }
            return { autoApproved, checkResult }
        })

        const detail = await this.orders.detail(id)
        return { ...detail, submitResult: result.checkResult, autoApproved: result.autoApproved }
    }

    /** Shared by auto-approve at submit and by the last manual approval (SalesApprovalsService). */
    async emitOrderApproved(
        tx: Prisma.TransactionClient,
        args: {
            orderId: string
            orderNo: string
            customerName: string
            recipientUserIds: string[]
            cycle: number
        },
    ) {
        await this.notificationOutbox.emit(
            {
                eventType: SALES_NOTIFICATION_EVENTS.ORDER_APPROVED,
                aggregateType: 'SALES_ORDER',
                aggregateId: args.orderId,
                dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_APPROVED}:${args.orderId}:cycle${args.cycle}`,
                payload: {
                    entityType: 'SALES_ORDER',
                    entityId: args.orderId,
                    orderNo: args.orderNo,
                    customerName: args.customerName,
                    cycle: args.cycle,
                    recipientUserIds: args.recipientUserIds,
                },
            },
            tx,
        )
    }

    /**
     * What an approved order does next depends on its kind: a LOT order only opens its draw
     * balances, a SINGLE order goes straight to holding stock and dispatching the warehouses.
     */
    async onApproved(tx: Prisma.TransactionClient, orderId: string, actor: SalesActor) {
        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            select: { kind: true },
        })
        if (order.kind === SalesOrderKind.LOT) {
            // A lot order commits a quantity; it holds nothing until a draw is requested.
            return this.lots.openPositions(tx, orderId)
        }
        return this.reserveAndDispatch(tx, orderId, actor)
    }

    /**
     * Approval does not touch stock — it triggers the hold, and a fully held order is
     * dispatched to the warehouses straight away (spec v1.2 §4.1, §8.1). Never throws on
     * shortage: the order parks at PARTIALLY_RESERVED/AWAITING_STOCK and sales can retry.
     */
    async reserveAndDispatch(tx: Prisma.TransactionClient, orderId: string, actor: SalesActor) {
        const outcome = await this.reservations.reserveOrder(tx, orderId, actor)
        if (outcome.fullyReserved) {
            await this.deliveries.createForOrder(tx, orderId, actor)
        } else if (outcome.lines.length) {
            const order = await tx.salesOrder.findUniqueOrThrow({
                where: { id: orderId },
                select: {
                    orderNo: true,
                    createdById: true,
                    submittedById: true,
                    version: true,
                    customer: { select: { name: true } },
                },
            })
            const shortages = outcome.lines.filter((line) => !new Prisma.Decimal(line.shortageQty).isZero())
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.ORDER_STOCK_INSUFFICIENT,
                    aggregateType: 'SALES_ORDER',
                    aggregateId: orderId,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_STOCK_INSUFFICIENT}:${orderId}:v${order.version}`,
                    payload: {
                        entityType: 'SALES_ORDER',
                        entityId: orderId,
                        orderNo: order.orderNo,
                        customerName: order.customer.name,
                        shortageSummary: shortages
                            .map(
                                (line) =>
                                    `${line.productName} tại ${line.warehouseName}: thiếu ${line.shortageQty}`,
                            )
                            .join('; '),
                        recipientUserIds: [order.createdById, order.submittedById].filter(
                            (value): value is string => !!value,
                        ),
                        recipientPermissionCodes: [PERMISSIONS.sales.deliveryConfirm],
                    },
                },
                tx,
            )
        }
        await this.orderStatus.recompute(tx, orderId)
        return outcome
    }

    /** Manual retry for an order parked at AWAITING_STOCK/PARTIALLY_RESERVED. */
    async retryReserve(id: string, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                select: { id: true, kind: true, status: true },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            const retryable: SalesOrderStatus[] = [
                SalesOrderStatus.CONFIRMED,
                SalesOrderStatus.AWAITING_STOCK,
                SalesOrderStatus.PARTIALLY_RESERVED,
            ]
            if (!retryable.includes(order.status)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_RESERVABLE',
                    message: `Không thể giữ hàng cho đơn ở trạng thái ${order.status}.`,
                })
            }
            await this.reserveAndDispatch(tx, id, actor)
        })
        return this.orders.detail(id)
    }

    async recall(id: string, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    customer: { select: { name: true } },
                    approvalRequests: { where: { status: { not: SalesApprovalStatus.STALE } } },
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (order.status !== SalesOrderStatus.PENDING_REVIEW) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_RECALLABLE',
                    message: 'Chỉ thu hồi được đơn đang chờ kiểm duyệt.',
                })
            }
            const currentCycle = order.approvalRequests.filter(
                (request) => request.approvalCycle === order.approvalCycle,
            )
            if (currentCycle.some((request) => request.status !== SalesApprovalStatus.PENDING)) {
                // Spec §5 (workflow gốc): chỉ thu hồi khi CHƯA có người xử lý.
                throw new BadRequestException({
                    code: 'SALES_ORDER_ALREADY_PROCESSED',
                    message: 'Đã có bộ phận xử lý yêu cầu duyệt — không thể thu hồi, hãy chờ kết quả.',
                })
            }
            await tx.salesApprovalRequest.updateMany({
                where: {
                    salesOrderId: id,
                    approvalCycle: order.approvalCycle,
                    status: SalesApprovalStatus.PENDING,
                },
                data: { status: SalesApprovalStatus.CANCELLED },
            })
            await tx.salesOrder.update({
                where: { id },
                data: { status: SalesOrderStatus.DRAFT, version: { increment: 1 } },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'RECALL',
                fromStatus: order.status,
                toStatus: SalesOrderStatus.DRAFT,
                actorId: actor.userId,
                cycle: order.approvalCycle,
            })
            const involvedPermissionCodes = [
                ...new Set(currentCycle.map((request) => APPROVAL_TYPE_PERMISSIONS[request.type])),
            ]
            if (involvedPermissionCodes.length) {
                await this.notificationOutbox.emit(
                    {
                        eventType: SALES_NOTIFICATION_EVENTS.ORDER_RECALLED,
                        aggregateType: 'SALES_ORDER',
                        aggregateId: id,
                        dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_RECALLED}:${id}:cycle${order.approvalCycle}`,
                        payload: {
                            entityType: 'SALES_ORDER',
                            entityId: id,
                            orderNo: order.orderNo,
                            customerName: order.customer.name,
                            cycle: order.approvalCycle,
                            recipientPermissionCodes: involvedPermissionCodes,
                            excludeUserIds: actor.userId ? [actor.userId] : [],
                        },
                    },
                    tx,
                )
            }
        })
        return this.orders.detail(id)
    }

    async cancel(id: string, reason: string | undefined, actor: SalesActor) {
        const cancellableStatuses: SalesOrderStatus[] = [
            SalesOrderStatus.DRAFT,
            SalesOrderStatus.PENDING_REVIEW,
            SalesOrderStatus.REJECTED,
            SalesOrderStatus.CONFIRMED,
            SalesOrderStatus.AWAITING_STOCK,
            SalesOrderStatus.PARTIALLY_RESERVED,
            SalesOrderStatus.RESERVED,
            // Allowed only while no delivery has posted — checked below (spec v1.2 §4.1).
            SalesOrderStatus.WAREHOUSE_PROCESSING,
        ]
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    customer: { select: { name: true } },
                    approvalRequests: { where: { status: SalesApprovalStatus.PENDING } },
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (!cancellableStatuses.includes(order.status)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_CANCELLABLE',
                    message: `Không thể hủy đơn ở trạng thái ${order.status}.`,
                })
            }
            if (await this.deliveries.hasPostedDelivery(tx, id)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_HAS_POSTED_DELIVERY',
                    message: 'Đơn đã có lệnh xuất kho thành công — phải xử lý bằng chứng từ điều chỉnh.',
                })
            }
            const cancelReason = reason?.trim() || `Hủy đơn bán ${order.orderNo}`
            await this.deliveries.voidOpenDeliveries(tx, id, actor, cancelReason)
            await this.reservations.releaseOrder(tx, id, actor, cancelReason)
            await tx.salesApprovalRequest.updateMany({
                where: { salesOrderId: id, status: SalesApprovalStatus.PENDING },
                data: { status: SalesApprovalStatus.CANCELLED },
            })
            await tx.salesOrder.update({
                where: { id },
                data: {
                    status: SalesOrderStatus.CANCELLED,
                    cancelledAt: new Date(),
                    cancelledById: actor.userId,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'CANCEL',
                fromStatus: order.status,
                toStatus: SalesOrderStatus.CANCELLED,
                actorId: actor.userId,
                reason: reason ?? null,
                cycle: order.approvalCycle,
            })

            const involvedPermissionCodes = [
                ...new Set(order.approvalRequests.map((request) => APPROVAL_TYPE_PERMISSIONS[request.type])),
            ]
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.ORDER_CANCELLED,
                    aggregateType: 'SALES_ORDER',
                    aggregateId: id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_CANCELLED}:${id}:v${order.version + 1}`,
                    payload: {
                        entityType: 'SALES_ORDER',
                        entityId: id,
                        orderNo: order.orderNo,
                        customerName: order.customer.name,
                        reasonSummary: reason ?? '',
                        cycle: order.approvalCycle,
                        recipientUserIds: order.createdById ? [order.createdById] : [],
                        recipientPermissionCodes: involvedPermissionCodes,
                        excludeUserIds: actor.userId ? [actor.userId] : [],
                    },
                },
                tx,
            )
        })
        return this.orders.detail(id)
    }

    /** Read-only preview of the internal checks for the Sale before submitting. */
    async previewChecks(id: string) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id },
            select: { id: true, kind: true },
        })
        if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
        this.assertInternalKind(order.kind)
        return this.checks.run(this.prisma, id)
    }
}
