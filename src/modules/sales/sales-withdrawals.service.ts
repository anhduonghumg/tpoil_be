import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    ReservationEventType,
    ReservationStatus,
    SalesApprovalStatus,
    SalesDeliveryStatus,
    SalesOrderKind,
    SalesOrderStatus,
    SalesWithdrawalStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { SalesLotService } from './sales-lot.service'
import { SalesWarehouseScopeService, ScopedActor } from './sales-warehouse-scope.service'
import {
    CancelWithdrawalDto,
    CreateWithdrawalDto,
    ListWithdrawalsQueryDto,
    SelectWithdrawalSourceDto,
    WithdrawalSourceQueryDto,
} from './dto/sales-lot.dto'

const detailInclude = Prisma.validator<Prisma.SalesLotWithdrawalRequestInclude>()({
    customer: { select: { id: true, code: true, name: true } },
    salesOrder: { select: { id: true, orderNo: true, orderDate: true, status: true } },
    lines: {
        orderBy: { lineNo: 'asc' },
        include: {
            product: { select: { id: true, code: true, name: true, uom: true } },
            warehouse: { select: { id: true, code: true, name: true } },
        },
    },
    deliveries: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, deliveryNo: true, status: true, warehouseId: true },
    },
})

/**
 * A draw against an existing LOT order (spec v1.2 §4.3, §6).
 *
 * Never creates a sales order. When several lot orders match, sales must choose — the
 * system may propose the oldest but must not deduct silently (nguyên tắc 4).
 */
@Injectable()
export class SalesWithdrawalsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly lots: SalesLotService,
        private readonly inventory: InventoryCoreService,
        private readonly events: SalesWorkflowEventsService,
        private readonly scope: SalesWarehouseScopeService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    private async nextRequestNo(tx: Prisma.TransactionClient, date: Date) {
        const year = String(date.getUTCFullYear()).slice(-2)
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        const period = `${year}${month}`
        const sequence = await tx.documentSequence.upsert({
            where: { moduleCode_period: { moduleCode: 'SALES_WITHDRAWAL', period } },
            create: { moduleCode: 'SALES_WITHDRAWAL', period, currentNo: 1 },
            update: { currentNo: { increment: 1 } },
        })
        return `RL${period}${String(sequence.currentNo).padStart(4, '0')}`
    }

    /**
     * Lot orders that can serve a draw: same customer, same product, same warehouse,
     * order still active, and enough left to draw. Plate, driver and the message's
     * "Đơn 1/2/3" numbering are explicitly NOT selection criteria (spec §6).
     */
    async sourceCandidates(query: WithdrawalSourceQueryDto) {
        const lines = await this.prisma.salesOrderLine.findMany({
            where: {
                productId: query.productId,
                issueWarehouseId: query.warehouseId ?? undefined,
                lotPosition: { isNot: null },
                salesOrder: {
                    kind: SalesOrderKind.LOT,
                    status: SalesOrderStatus.CONFIRMED,
                    customerPartyId: query.customerPartyId,
                },
            },
            include: {
                product: { select: { id: true, code: true, name: true, uom: true } },
                issueWarehouse: { select: { id: true, code: true, name: true } },
                salesOrder: { select: { id: true, orderNo: true, orderDate: true } },
            },
            // Oldest lot first — that is the proposal order, not an automatic pick.
            // createdAt breaks ties so two lots booked the same day stay in a stable order.
            orderBy: [{ salesOrder: { orderDate: 'asc' } }, { salesOrder: { createdAt: 'asc' } }],
        })

        const needed = query.qty == null ? null : new Prisma.Decimal(query.qty)
        const candidates: Array<{
            salesOrderId: string
            orderNo: string
            orderDate: Date
            salesOrderLineId: string
            product: { id: string; code: string; name: string; uom: string }
            warehouse: { id: string; code: string; name: string } | null
            totalQty: string
            issuedQty: string
            heldQty: string
            remainingQty: string
        }> = []
        for (const line of lines) {
            const balance = await this.lots.balanceForLine(this.prisma, line.id)
            if (!balance) continue
            const remaining = new Prisma.Decimal(balance.remainingQty)
            if (!remaining.greaterThan(0)) continue
            if (needed && remaining.lessThan(needed)) continue
            candidates.push({
                salesOrderId: line.salesOrder.id,
                orderNo: line.salesOrder.orderNo,
                orderDate: line.salesOrder.orderDate,
                salesOrderLineId: line.id,
                product: line.product,
                warehouse: line.issueWarehouse,
                totalQty: balance.totalQty,
                issuedQty: balance.issuedQty,
                heldQty: balance.heldQty,
                remainingQty: balance.remainingQty,
            })
        }
        return {
            candidates,
            // The UI must force a choice when more than one lot fits.
            mustChoose: candidates.length > 1,
            suggestedSalesOrderId: candidates.length ? candidates[0].salesOrderId : null,
        }
    }

    async create(dto: CreateWithdrawalDto, actor: ScopedActor) {
        const requestDate = dto.requestDate ? new Date(dto.requestDate) : new Date()
        if (Number.isNaN(requestDate.getTime())) throw new BadRequestException('REQUEST_DATE_INVALID')

        const id = await this.prisma.$transaction(async (tx) => {
            const customer = await tx.party.findUnique({
                where: { id: dto.customerPartyId },
                select: { id: true },
            })
            if (!customer) throw new BadRequestException('CUSTOMER_NOT_FOUND')

            const request = await tx.salesLotWithdrawalRequest.create({
                data: {
                    requestNo: await this.nextRequestNo(tx, requestDate),
                    customerPartyId: dto.customerPartyId,
                    salesOrderId: null,
                    status: SalesWithdrawalStatus.DRAFT,
                    requestDate,
                    vehiclePlate: dto.vehiclePlate?.trim() || null,
                    driverName: dto.driverName?.trim() || null,
                    note: dto.note?.trim() || null,
                    createdById: actor.userId,
                    lines: {
                        create: dto.lines.map((line, index) => ({
                            lineNo: index + 1,
                            productId: line.productId,
                            warehouseId: line.warehouseId,
                            requestedQty: new Prisma.Decimal(line.requestedQty),
                            requestedV15Qty:
                                line.requestedV15Qty == null
                                    ? null
                                    : new Prisma.Decimal(line.requestedV15Qty),
                        })),
                    },
                },
                select: { id: true },
            })
            await this.events.record(tx, {
                entityType: 'SALES_WITHDRAWAL',
                entityId: request.id,
                eventType: 'CREATE',
                toStatus: SalesWithdrawalStatus.DRAFT,
                actorId: actor.userId,
            })
            return request.id
        })

        // Try to attach the source straight away; if sales picked one, honour it.
        if (dto.salesOrderId) {
            return this.selectSource(id, { salesOrderId: dto.salesOrderId }, actor)
        }
        return this.autoResolveSource(id, actor)
    }

    /** Proposes a source when exactly one lot fits; otherwise waits for sales to choose. */
    private async autoResolveSource(id: string, actor: ScopedActor) {
        const request = await this.prisma.salesLotWithdrawalRequest.findUniqueOrThrow({
            where: { id },
            include: { lines: true },
        })
        const perLine = await Promise.all(
            request.lines.map((line) =>
                this.sourceCandidates({
                    customerPartyId: request.customerPartyId,
                    productId: line.productId,
                    warehouseId: line.warehouseId,
                    qty: Number(line.requestedQty),
                }),
            ),
        )
        const orderIdSets = perLine.map(
            (result) => new Set(result.candidates.map((row) => row.salesOrderId)),
        )
        const common = orderIdSets.length
            ? [...orderIdSets[0]].filter((orderId) => orderIdSets.every((set) => set.has(orderId)))
            : []

        if (common.length === 1) {
            return this.selectSource(id, { salesOrderId: common[0] }, actor)
        }

        // Zero matches: park the request. Never invent a lot order, never turn it into a
        // one-off order, never draw from another customer's lot (spec §6).
        if (common.length === 0) {
            await this.prisma.$transaction(async (tx) => {
                await tx.salesLotWithdrawalRequest.update({
                    where: { id },
                    data: { status: SalesWithdrawalStatus.NEED_SOURCE, version: { increment: 1 } },
                })
                await this.events.record(tx, {
                    entityType: 'SALES_WITHDRAWAL',
                    entityId: id,
                    eventType: 'NEED_SOURCE',
                    toStatus: SalesWithdrawalStatus.NEED_SOURCE,
                    actorId: actor.userId,
                })
                await this.notificationOutbox.emit(
                    {
                        eventType: SALES_NOTIFICATION_EVENTS.WITHDRAWAL_NEED_SOURCE,
                        aggregateType: 'SALES_WITHDRAWAL',
                        aggregateId: id,
                        dedupeKey: `${SALES_NOTIFICATION_EVENTS.WITHDRAWAL_NEED_SOURCE}:${id}:v${request.version}`,
                        payload: {
                            entityType: 'SALES_WITHDRAWAL',
                            entityId: id,
                            workItemSourceType: 'SALES_WITHDRAWAL',
                            workItemSourceId: id,
                            actionRequired: true,
                            sourceVersion: request.version,
                            requestNo: request.requestNo,
                            recipientUserIds: request.createdById ? [request.createdById] : [],
                        },
                    },
                    tx,
                )
            })
        }
        // Several matches: leave it in DRAFT so sales must pick explicitly.
        return this.detail(id)
    }

    async selectSource(id: string, dto: SelectWithdrawalSourceDto, actor: ScopedActor) {
        await this.prisma.$transaction(async (tx) => {
            const request = await tx.salesLotWithdrawalRequest.findUnique({
                where: { id },
                include: { lines: true },
            })
            if (!request) throw new NotFoundException('SALES_WITHDRAWAL_NOT_FOUND')
            if (
                request.status !== SalesWithdrawalStatus.DRAFT &&
                request.status !== SalesWithdrawalStatus.NEED_SOURCE
            ) {
                throw new BadRequestException({
                    code: 'WITHDRAWAL_SOURCE_LOCKED',
                    message: 'Chỉ chọn được đơn lô nguồn khi yêu cầu còn ở trạng thái nháp.',
                })
            }

            const lotOrder = await tx.salesOrder.findUnique({
                where: { id: dto.salesOrderId },
                include: { lines: { include: { lotPosition: true } } },
            })
            if (!lotOrder) throw new BadRequestException('SALES_ORDER_NOT_FOUND')
            // Checked first: drawing from another customer's lot is a data-integrity breach,
            // and saying "not active" would mask it (spec §6).
            if (lotOrder.customerPartyId !== request.customerPartyId) {
                throw new BadRequestException({
                    code: 'WITHDRAWAL_SOURCE_CUSTOMER_MISMATCH',
                    message: 'Đơn lô nguồn không thuộc khách hàng của yêu cầu rút.',
                })
            }
            if (lotOrder.kind !== SalesOrderKind.LOT || lotOrder.status !== SalesOrderStatus.CONFIRMED) {
                throw new BadRequestException({
                    code: 'WITHDRAWAL_SOURCE_NOT_ACTIVE_LOT',
                    message: 'Đơn nguồn phải là đơn lô đang hoạt động.',
                })
            }

            for (const line of request.lines) {
                const match = lotOrder.lines.find(
                    (orderLine) =>
                        orderLine.productId === line.productId &&
                        orderLine.issueWarehouseId === line.warehouseId &&
                        orderLine.lotPosition,
                )
                if (!match) {
                    throw new BadRequestException({
                        code: 'WITHDRAWAL_SOURCE_LINE_NOT_FOUND',
                        message: `Đơn lô nguồn không có dòng phù hợp cho dòng ${line.lineNo}.`,
                    })
                }
                const balance = await this.lots.balanceForLine(tx, match.id)
                if (!balance || new Prisma.Decimal(line.requestedQty).greaterThan(balance.remainingQty)) {
                    throw new BadRequestException({
                        code: 'WITHDRAWAL_EXCEEDS_REMAINING',
                        message: `Dòng ${line.lineNo}: số lượng rút vượt số còn có thể rút (${balance?.remainingQty ?? 0}).`,
                    })
                }
                await tx.salesLotWithdrawalRequestLine.update({
                    where: { id: line.id },
                    data: { salesOrderLineId: match.id },
                })
            }

            await tx.salesLotWithdrawalRequest.update({
                where: { id },
                data: {
                    salesOrderId: lotOrder.id,
                    status: SalesWithdrawalStatus.DRAFT,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_WITHDRAWAL',
                entityId: id,
                eventType: 'SELECT_SOURCE',
                fromStatus: request.status,
                toStatus: SalesWithdrawalStatus.DRAFT,
                actorId: actor.userId,
                metadata: { salesOrderId: lotOrder.id },
            })
        })
        return this.detail(id)
    }

    async submit(id: string, actor: ScopedActor) {
        await this.prisma.$transaction(async (tx) => {
            const request = await tx.salesLotWithdrawalRequest.findUnique({
                where: { id },
                include: {
                    lines: true,
                    customer: { select: { name: true, status: true } },
                    salesOrder: { select: { id: true, orderNo: true, status: true, kind: true } },
                },
            })
            if (!request) throw new NotFoundException('SALES_WITHDRAWAL_NOT_FOUND')
            if (request.status !== SalesWithdrawalStatus.DRAFT) {
                throw new BadRequestException({
                    code: 'WITHDRAWAL_NOT_SUBMITTABLE',
                    message: 'Chỉ gửi kiểm duyệt được yêu cầu rút ở trạng thái nháp.',
                })
            }
            if (!request.salesOrderId || request.lines.some((line) => !line.salesOrderLineId)) {
                throw new BadRequestException({
                    code: 'WITHDRAWAL_SOURCE_REQUIRED',
                    message: 'Phải chọn đơn lô nguồn trước khi gửi kiểm duyệt.',
                })
            }
            if (!request.vehiclePlate || !request.driverName) {
                throw new BadRequestException({
                    code: 'VEHICLE_DRIVER_REQUIRED',
                    message: 'Yêu cầu rút phải có BKS và lái xe.',
                })
            }
            if (request.customer.status !== 'Active') {
                throw new BadRequestException({
                    code: 'CUSTOMER_NOT_ACTIVE',
                    message: 'Khách hàng không còn hoạt động.',
                })
            }

            // Re-check the balance at submit time: another draw may have taken it meanwhile.
            for (const line of request.lines) {
                const balance = await this.lots.balanceForLine(tx, line.salesOrderLineId!)
                if (!balance || new Prisma.Decimal(line.requestedQty).greaterThan(balance.remainingQty)) {
                    throw new BadRequestException({
                        code: 'WITHDRAWAL_EXCEEDS_REMAINING',
                        message: `Dòng ${line.lineNo}: số còn có thể rút chỉ còn ${balance?.remainingQty ?? 0}.`,
                    })
                }
            }

            const cycle = request.approvalCycle + 1
            await tx.salesApprovalRequest.updateMany({
                where: { withdrawalRequestId: id, status: SalesApprovalStatus.PENDING },
                data: { status: SalesApprovalStatus.STALE },
            })

            // Price and terms were settled on the lot order, so a draw normally needs no
            // manual approval; policy checks stay on the parent order.
            await tx.salesLotWithdrawalRequest.update({
                where: { id },
                data: {
                    status: SalesWithdrawalStatus.APPROVED,
                    approvalCycle: cycle,
                    submittedAt: new Date(),
                    submittedById: actor.userId,
                    approvedAt: new Date(),
                    rejectedReason: null,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_WITHDRAWAL',
                entityId: id,
                eventType: 'SUBMIT',
                fromStatus: SalesWithdrawalStatus.DRAFT,
                toStatus: SalesWithdrawalStatus.APPROVED,
                actorId: actor.userId,
                cycle,
            })
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.WITHDRAWAL_APPROVED,
                    aggregateType: 'SALES_WITHDRAWAL',
                    aggregateId: id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.WITHDRAWAL_APPROVED}:${id}:cycle${cycle}`,
                    payload: {
                        entityType: 'SALES_WITHDRAWAL',
                        entityId: id,
                        requestNo: request.requestNo,
                        orderNo: request.salesOrder?.orderNo ?? '',
                        customerName: request.customer.name,
                        cycle,
                        recipientUserIds: [request.createdById, actor.userId].filter(
                            (value): value is string => !!value,
                        ),
                    },
                },
                tx,
            )

            await this.reserveAndDispatch(tx, id, actor)
        })
        return this.detail(id)
    }

    /** Holds stock for the approved draw and hands one job to each warehouse. */
    private async reserveAndDispatch(tx: Prisma.TransactionClient, id: string, actor: ScopedActor) {
        const request = await tx.salesLotWithdrawalRequest.findUniqueOrThrow({
            where: { id },
            include: {
                lines: {
                    include: {
                        warehouse: { select: { id: true, name: true, legalEntity: { select: { partyId: true } } } },
                        product: { select: { name: true } },
                    },
                },
                salesOrder: { select: { id: true, orderNo: true, legalEntityId: true, orderDate: true } },
                customer: { select: { name: true } },
            },
        })

        const period = `${String(request.requestDate.getUTCFullYear()).slice(-2)}${String(request.requestDate.getUTCMonth() + 1).padStart(2, '0')}`
        const sequence = await tx.documentSequence.upsert({
            where: { moduleCode_period: { moduleCode: 'SALES_RESERVATION', period } },
            create: { moduleCode: 'SALES_RESERVATION', period, currentNo: 1 },
            update: { currentNo: { increment: 1 } },
        })
        const reservation = await tx.inventoryReservation.create({
            data: {
                reservationNo: `GH${period}${String(sequence.currentNo).padStart(4, '0')}`,
                legalEntityId: request.salesOrder!.legalEntityId,
                customerPartyId: request.customerPartyId,
                withdrawalRequestId: id,
                // A lot draw has no expiry, same as the lot order itself (nguyên tắc 2).
                expiresAt: null,
                note: `Giữ hàng cho yêu cầu rút ${request.requestNo}`,
                lines: {
                    create: request.lines.map((line, index) => ({
                        lineNo: index + 1,
                        warehouseId: line.warehouseId,
                        productId: line.productId,
                        ownerPartyId: line.warehouse.legalEntity.partyId,
                        salesOrderLineId: line.salesOrderLineId,
                        withdrawalRequestLineId: line.id,
                        requestedActualQty: line.requestedQty,
                        requestedV15Qty: line.requestedV15Qty,
                    })),
                },
            },
            include: { lines: true },
        })

        let fullyReserved = true
        for (const reservationLine of reservation.lines) {
            const balance = await tx.inventoryAvailabilityBalance.findUnique({
                where: {
                    warehouseId_productId_ownerPartyId: {
                        warehouseId: reservationLine.warehouseId,
                        productId: reservationLine.productId,
                        ownerPartyId: reservationLine.ownerPartyId,
                    },
                },
            })
            const available = balance
                ? new Prisma.Decimal(balance.onHandActualQty)
                      .minus(balance.reservedActualQty)
                      .minus(balance.pendingActualQty)
                      .minus(balance.blockedActualQty)
                : new Prisma.Decimal(0)
            const takeQty = Prisma.Decimal.min(reservationLine.requestedActualQty, available)
            if (!takeQty.greaterThan(0)) {
                fullyReserved = false
                continue
            }
            const attempt = await tx.inventoryReservationEvent.count({
                where: { reservationLineId: reservationLine.id, type: ReservationEventType.ACTIVATE },
            })
            await this.inventory.activateReservationLine(tx, {
                reservationLineId: reservationLine.id,
                actualQty: takeQty,
                v15Qty: null,
                idempotencyKey: `withdrawal:${id}:reserve:${reservationLine.id}:${attempt}`,
                occurredAt: new Date(),
                actorId: actor.userId,
                reason: `Giữ hàng rút lô ${request.requestNo}`,
            })
            if (takeQty.lessThan(reservationLine.requestedActualQty)) fullyReserved = false
        }

        if (!fullyReserved) {
            await tx.salesLotWithdrawalRequest.update({
                where: { id },
                data: { status: SalesWithdrawalStatus.RESERVED, version: { increment: 1 } },
            })
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.ORDER_STOCK_INSUFFICIENT,
                    aggregateType: 'SALES_WITHDRAWAL',
                    aggregateId: id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_STOCK_INSUFFICIENT}:${id}:v${request.version}`,
                    payload: {
                        entityType: 'SALES_WITHDRAWAL',
                        entityId: id,
                        orderNo: request.requestNo,
                        customerName: request.customer.name,
                        shortageSummary: 'Kho chưa đủ hàng khả dụng cho yêu cầu rút.',
                        recipientUserIds: request.createdById ? [request.createdById] : [],
                        recipientPermissionCodes: [PERMISSIONS.sales.deliveryConfirm],
                    },
                },
                tx,
            )
            return
        }

        // One delivery job per warehouse, exactly like a SINGLE order (spec v1.2 D1).
        const byWarehouse = new Map<string, typeof request.lines>()
        for (const line of request.lines) {
            const group = byWarehouse.get(line.warehouseId) ?? []
            group.push(line)
            byWarehouse.set(line.warehouseId, group)
        }
        for (const [warehouseId, lines] of byWarehouse) {
            const deliveryPeriod = period
            const deliverySeq = await tx.documentSequence.upsert({
                where: { moduleCode_period: { moduleCode: 'SALES_DELIVERY', period: deliveryPeriod } },
                create: { moduleCode: 'SALES_DELIVERY', period: deliveryPeriod, currentNo: 1 },
                update: { currentNo: { increment: 1 } },
            })
            const delivery = await tx.salesDelivery.create({
                data: {
                    deliveryNo: `XK${deliveryPeriod}${String(deliverySeq.currentNo).padStart(4, '0')}`,
                    salesOrderId: request.salesOrderId!,
                    withdrawalRequestId: id,
                    warehouseId,
                    status: SalesDeliveryStatus.READY,
                    plannedAt: request.requestDate,
                    vehiclePlate: request.vehiclePlate,
                    driverName: request.driverName,
                    vehicleId: request.vehicleId,
                    driverId: request.driverId,
                    createdById: actor.userId,
                    lines: {
                        create: lines.map((line, index) => ({
                            lineNo: index + 1,
                            salesOrderLineId: line.salesOrderLineId!,
                            ownerPartyId: line.warehouse.legalEntity.partyId,
                            plannedActualQty: line.requestedQty,
                            plannedV15Qty: line.requestedV15Qty,
                        })),
                    },
                },
                select: { id: true, deliveryNo: true },
            })
            const recipientUserIds = await this.scope.usersForWarehouse(warehouseId, [
                PERMISSIONS.sales.deliveryConfirm,
            ])
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.DELIVERY_READY,
                    aggregateType: 'SALES_DELIVERY',
                    aggregateId: delivery.id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.DELIVERY_READY}:${delivery.id}:v1`,
                    payload: {
                        entityType: 'SALES_DELIVERY',
                        entityId: delivery.id,
                        workItemSourceType: 'SALES_DELIVERY',
                        workItemSourceId: delivery.id,
                        actionRequired: true,
                        sourceVersion: 1,
                        deliveryNo: delivery.deliveryNo,
                        orderNo: request.requestNo,
                        customerName: request.customer.name,
                        warehouseId,
                        warehouseName: lines[0].warehouse.name,
                        vehiclePlate: request.vehiclePlate ?? '',
                        recipientUserIds,
                    },
                },
                tx,
            )
        }

        await tx.salesLotWithdrawalRequest.update({
            where: { id },
            data: { status: SalesWithdrawalStatus.WAREHOUSE_PROCESSING, version: { increment: 1 } },
        })
    }

    /** Called after the warehouse posts a draw delivery. */
    async onDeliveryPosted(tx: Prisma.TransactionClient, withdrawalRequestId: string) {
        const request = await tx.salesLotWithdrawalRequest.findUniqueOrThrow({
            where: { id: withdrawalRequestId },
            include: { deliveries: { select: { status: true } } },
        })
        const live = request.deliveries.filter((row) => row.status !== SalesDeliveryStatus.VOIDED)
        if (!live.length || !live.every((row) => row.status === SalesDeliveryStatus.POSTED)) return null
        await tx.salesLotWithdrawalRequest.update({
            where: { id: withdrawalRequestId },
            data: { status: SalesWithdrawalStatus.ISSUED, version: { increment: 1 } },
        })
        if (request.salesOrderId) await this.lots.closeIfComplete(tx, request.salesOrderId)
        return SalesWithdrawalStatus.ISSUED
    }

    async cancel(id: string, dto: CancelWithdrawalDto, actor: ScopedActor) {
        await this.prisma.$transaction(async (tx) => {
            const request = await tx.salesLotWithdrawalRequest.findUnique({
                where: { id },
                include: { deliveries: { select: { id: true, status: true } } },
            })
            if (!request) throw new NotFoundException('SALES_WITHDRAWAL_NOT_FOUND')
            if (
                request.status === SalesWithdrawalStatus.ISSUED ||
                request.status === SalesWithdrawalStatus.CANCELLED
            ) {
                throw new BadRequestException({
                    code: 'WITHDRAWAL_NOT_CANCELLABLE',
                    message: `Không thể hủy yêu cầu rút ở trạng thái ${request.status}.`,
                })
            }
            if (request.deliveries.some((row) => row.status === SalesDeliveryStatus.POSTED)) {
                throw new BadRequestException({
                    code: 'WITHDRAWAL_HAS_POSTED_DELIVERY',
                    message: 'Yêu cầu rút đã có lệnh xuất thành công — phải dùng chứng từ điều chỉnh.',
                })
            }

            const reason = dto.reason?.trim() || `Hủy yêu cầu rút ${request.requestNo}`
            await tx.salesDelivery.updateMany({
                where: { withdrawalRequestId: id, status: { not: SalesDeliveryStatus.POSTED } },
                data: { status: SalesDeliveryStatus.VOIDED },
            })
            const reservations = await tx.inventoryReservation.findMany({
                where: {
                    withdrawalRequestId: id,
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
                        idempotencyKey: `withdrawal:${id}:release:${line.id}`,
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
            await tx.salesApprovalRequest.updateMany({
                where: { withdrawalRequestId: id, status: SalesApprovalStatus.PENDING },
                data: { status: SalesApprovalStatus.CANCELLED },
            })
            await tx.salesLotWithdrawalRequest.update({
                where: { id },
                data: {
                    status: SalesWithdrawalStatus.CANCELLED,
                    cancelledAt: new Date(),
                    cancelledById: actor.userId,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_WITHDRAWAL',
                entityId: id,
                eventType: 'CANCEL',
                fromStatus: request.status,
                toStatus: SalesWithdrawalStatus.CANCELLED,
                actorId: actor.userId,
                reason,
            })
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.WITHDRAWAL_CANCELLED,
                    aggregateType: 'SALES_WITHDRAWAL',
                    aggregateId: id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.WITHDRAWAL_CANCELLED}:${id}:v${request.version + 1}`,
                    payload: {
                        entityType: 'SALES_WITHDRAWAL',
                        entityId: id,
                        requestNo: request.requestNo,
                        reasonSummary: reason,
                        recipientUserIds: request.createdById ? [request.createdById] : [],
                        excludeUserIds: actor.userId ? [actor.userId] : [],
                    },
                },
                tx,
            )
        })
        return this.detail(id)
    }

    async list(query: ListWithdrawalsQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const where: Prisma.SalesLotWithdrawalRequestWhereInput = {
            status: query.status ? (query.status as SalesWithdrawalStatus) : undefined,
            customerPartyId: query.customerPartyId ?? undefined,
            salesOrderId: query.salesOrderId ?? undefined,
        }
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.salesLotWithdrawalRequest.findMany({
                where,
                include: detailInclude,
                orderBy: [{ requestDate: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.salesLotWithdrawalRequest.count({ where }),
        ])
        return { items: rows, total, page, limit }
    }

    async detail(id: string) {
        const request = await this.prisma.salesLotWithdrawalRequest.findUnique({
            where: { id },
            include: detailInclude,
        })
        if (!request) throw new NotFoundException('SALES_WITHDRAWAL_NOT_FOUND')
        const balances = await Promise.all(
            request.lines
                .filter((line) => line.salesOrderLineId)
                .map((line) => this.lots.balanceForLine(this.prisma, line.salesOrderLineId!)),
        )
        return { ...request, sourceBalances: balances.filter(Boolean) }
    }
}
