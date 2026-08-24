import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import {
    Prisma,
    ReservationStatus,
    SalesOrderKind,
    SalesOrderStatus,
    SalesOrderSupplySource,
} from '@prisma/client'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { SalesActor } from './sales-order-workflow.service'

export type ReserveLotOutcome = {
    inventoryLotId: string
    lotNo: string
    supplierPartyId: string
    supplierCode: string
    supplierName: string
    releaseCode: SalesOrderSupplySource
    actualQty: string
}

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
    allocations: ReserveLotOutcome[]
}

export type ReserveOutcome = {
    reservationId: string | null
    fullyReserved: boolean
    lines: ReserveLineOutcome[]
}

export type SupplierChoiceOption = {
    supplierPartyId: string
    supplierCode: string
    supplierName: string
    availableQty: string
}

export type SupplierChoicePreview = {
    fifoAllocations: ReserveLotOutcome[]
    supplierOptions: SupplierChoiceOption[]
    availableQty: string
    shortageQty: string
}

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

    /** Tồn khả dụng theo lô; lô đồng thời mang mã NCC và mã rút TP/NCC. */
    private async fifoLots(
        tx: Prisma.TransactionClient,
        key: {
            warehouseId: string
            productId: string
            ownerPartyId: string
            supplySource: SalesOrderSupplySource
            supplierPartyId?: string
        },
        lock = true,
    ) {
        const stock = await tx.stockBalance.findMany({
            where: {
                warehouseId: key.warehouseId,
                productId: key.productId,
                ownerPartyId: key.ownerPartyId,
                actualQty: { gt: 0 },
                lot: {
                    releaseCode: key.supplySource,
                    supplierPartyId: key.supplierPartyId ?? { not: null },
                },
            },
            include: {
                lot: {
                    select: {
                        id: true,
                        lotNo: true,
                        receivedAt: true,
                        releaseCode: true,
                        supplierPartyId: true,
                        supplier: { select: { id: true, code: true, name: true } },
                    },
                },
            },
            orderBy: [{ lot: { receivedAt: 'asc' } }, { lot: { lotNo: 'asc' } }],
        })
        if (!stock.length) return []

        // Cùng thứ tự khoá ở mọi lượt duyệt để không giữ trùng một lô khi xử lý đồng thời.
        if (lock) {
            for (const row of stock) {
                const lockKey = `sales-fifo:${row.warehouseId}:${row.productId}:${row.ownerPartyId}:${row.inventoryLotId}`
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
            }
        }

        const lotIds = stock.map((row) => row.inventoryLotId)
        const [reserved, pending, blocked] = await Promise.all([
            tx.inventoryReservationLine.groupBy({
                by: ['inventoryLotId'],
                where: { inventoryLotId: { in: lotIds }, activeActualQty: { gt: 0 } },
                _sum: { activeActualQty: true },
            }),
            tx.inventoryPendingRelease.groupBy({
                by: ['inventoryLotId'],
                where: {
                    inventoryLotId: { in: lotIds },
                    status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
                    activeActualQty: { gt: 0 },
                },
                _sum: { activeActualQty: true },
            }),
            tx.inventoryBlock.groupBy({
                by: ['inventoryLotId'],
                where: {
                    inventoryLotId: { in: lotIds },
                    status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
                    activeActualQty: { gt: 0 },
                },
                _sum: { activeActualQty: true },
            }),
        ])
        const reservedByLot = new Map<string, Prisma.Decimal>()
        const pendingByLot = new Map<string, Prisma.Decimal>()
        const blockedByLot = new Map<string, Prisma.Decimal>()
        for (const row of reserved) {
            if (row.inventoryLotId) reservedByLot.set(row.inventoryLotId, new Prisma.Decimal(row._sum.activeActualQty ?? 0))
        }
        for (const row of pending) {
            if (row.inventoryLotId) pendingByLot.set(row.inventoryLotId, new Prisma.Decimal(row._sum.activeActualQty ?? 0))
        }
        for (const row of blocked) {
            if (row.inventoryLotId) blockedByLot.set(row.inventoryLotId, new Prisma.Decimal(row._sum.activeActualQty ?? 0))
        }

        return stock.map((row) => ({
            ...row,
            availableQty: Prisma.Decimal.max(
                new Prisma.Decimal(row.actualQty)
                    .minus(reservedByLot.get(row.inventoryLotId) ?? 0)
                    .minus(pendingByLot.get(row.inventoryLotId) ?? 0)
                    .minus(blockedByLot.get(row.inventoryLotId) ?? 0),
                0,
            ),
        }))
    }

    /**
     * Phương án chỉ để hiển thị trên hàng đợi duyệt. Không giữ tồn và không khóa lô; khi duyệt
     * reserveOrder vẫn tính và khóa lại để tránh hai quản lý cùng duyệt vào một lượng hàng.
     */
    async previewSupplierChoices(
        tx: Prisma.TransactionClient,
        key: {
            warehouseId: string
            productId: string
            ownerPartyId: string
            supplySource: SalesOrderSupplySource
        },
        requestedQtyInput: Prisma.Decimal.Value,
    ): Promise<SupplierChoicePreview> {
        const candidates = await this.fifoLots(tx, key, false)
        const supplierTotals = new Map<string, SupplierChoiceOption & { qty: Prisma.Decimal }>()
        for (const candidate of candidates) {
            if (!candidate.lot.supplier || !candidate.availableQty.greaterThan(0)) continue
            const current = supplierTotals.get(candidate.lot.supplier.id)
            if (current) {
                current.qty = current.qty.plus(candidate.availableQty)
                current.availableQty = current.qty.toString()
            } else {
                supplierTotals.set(candidate.lot.supplier.id, {
                    supplierPartyId: candidate.lot.supplier.id,
                    supplierCode: candidate.lot.supplier.code,
                    supplierName: candidate.lot.supplier.name,
                    availableQty: candidate.availableQty.toString(),
                    qty: candidate.availableQty,
                })
            }
        }

        const requestedQty = new Prisma.Decimal(requestedQtyInput)
        let missing = requestedQty
        const fifoAllocations: ReserveLotOutcome[] = []
        for (const candidate of candidates) {
            if (!missing.greaterThan(0)) break
            if (!candidate.availableQty.greaterThan(0) || !candidate.lot.supplier || !candidate.lot.releaseCode) continue
            const takeQty = Prisma.Decimal.min(missing, candidate.availableQty)
            fifoAllocations.push({
                inventoryLotId: candidate.inventoryLotId,
                lotNo: candidate.lot.lotNo,
                supplierPartyId: candidate.lot.supplier.id,
                supplierCode: candidate.lot.supplier.code,
                supplierName: candidate.lot.supplier.name,
                releaseCode: candidate.lot.releaseCode,
                actualQty: takeQty.toString(),
            })
            missing = missing.minus(takeQty)
        }

        return {
            fifoAllocations,
            supplierOptions: [...supplierTotals.values()].map(({ qty: _qty, ...option }) => option),
            availableQty: requestedQty.minus(Prisma.Decimal.max(missing, 0)).toString(),
            shortageQty: Prisma.Decimal.max(missing, 0).toString(),
        }
    }

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
                                areaId: true,
                                legalEntity: { select: { partyId: true } },
                            },
                        },
                    },
                },
            },
        })

        // Đơn lô chỉ giữ tồn khi khách tạo yêu cầu rút hàng.
        if (order.kind !== SalesOrderKind.SINGLE) {
            return { reservationId: null, fullyReserved: true, lines: [] }
        }

        const openReservations = await tx.inventoryReservation.findMany({
            where: {
                salesOrderId: orderId,
                status: { in: [ReservationStatus.DRAFT, ReservationStatus.ACTIVE] },
            },
            include: {
                lines: {
                    include: {
                        lot: {
                            select: {
                                id: true,
                                lotNo: true,
                                releaseCode: true,
                                supplier: { select: { id: true, code: true, name: true } },
                            },
                        },
                    },
                },
            },
        })

        const alreadyHeld = new Map<string, Prisma.Decimal>()
        const existingAllocations = new Map<string, ReserveLotOutcome[]>()
        for (const reservation of openReservations) {
            for (const line of reservation.lines) {
                if (!line.salesOrderLineId) continue
                const activeQty = new Prisma.Decimal(line.activeActualQty)
                alreadyHeld.set(
                    line.salesOrderLineId,
                    (alreadyHeld.get(line.salesOrderLineId) ?? new Prisma.Decimal(0)).plus(activeQty),
                )
                if (!activeQty.greaterThan(0) || !line.lot?.supplier || !line.lot.releaseCode) continue
                const allocations = existingAllocations.get(line.salesOrderLineId) ?? []
                allocations.push({
                    inventoryLotId: line.lot.id,
                    lotNo: line.lot.lotNo,
                    supplierPartyId: line.lot.supplier.id,
                    supplierCode: line.lot.supplier.code,
                    supplierName: line.lot.supplier.name,
                    releaseCode: line.lot.releaseCode,
                    actualQty: activeQty.toString(),
                })
                existingAllocations.set(line.salesOrderLineId, allocations)
            }
        }

        let reservationId = openReservations[0]?.id ?? null
        let freshReservationId: string | null = null
        let freshLineNo = 0
        const outcomes: ReserveLineOutcome[] = []

        for (const orderLine of order.lines) {
            if (!orderLine.issueWarehouse) continue
            const orderedQty = new Prisma.Decimal(orderLine.orderedActualQty)
            let reservedNow = alreadyHeld.get(orderLine.id) ?? new Prisma.Decimal(0)
            let missing = Prisma.Decimal.max(orderedQty.minus(reservedNow), 0)
            const allocations = [...(existingAllocations.get(orderLine.id) ?? [])]

            if (missing.greaterThan(0)) {
                const candidates = await this.fifoLots(tx, {
                    warehouseId: orderLine.issueWarehouse.id,
                    productId: orderLine.productId,
                    ownerPartyId: orderLine.issueWarehouse.legalEntity.partyId,
                    supplySource: orderLine.supplySource,
                    supplierPartyId: orderLine.preferredSupplierPartyId ?? undefined,
                })
                for (const candidate of candidates) {
                    if (!missing.greaterThan(0)) break
                    if (!candidate.availableQty.greaterThan(0) || !candidate.lot.supplier || !candidate.lot.releaseCode) continue
                    const takeQty = Prisma.Decimal.min(missing, candidate.availableQty)

                    if (!freshReservationId) {
                        const fresh = await tx.inventoryReservation.create({
                            data: {
                                reservationNo: await this.nextReservationNo(tx, order.orderDate),
                                legalEntityId: order.legalEntityId,
                                customerPartyId: order.customerPartyId,
                                salesOrderId: orderId,
                                expiresAt: null,
                                note: `Giữ hàng FIFO cho đơn bán ${order.orderNo}`,
                            },
                        })
                        freshReservationId = fresh.id
                        reservationId = reservationId ?? fresh.id
                    }

                    const requestedV15Qty =
                        orderLine.orderedV15Qty == null
                            ? null
                            : new Prisma.Decimal(orderLine.orderedV15Qty).times(takeQty).div(orderedQty)
                    const reservationLine = await tx.inventoryReservationLine.create({
                        data: {
                            reservationId: freshReservationId,
                            lineNo: ++freshLineNo,
                            warehouseId: candidate.warehouseId,
                            productId: candidate.productId,
                            ownerPartyId: candidate.ownerPartyId,
                            salesOrderLineId: orderLine.id,
                            inventoryLotId: candidate.inventoryLotId,
                            requestedActualQty: takeQty,
                            requestedV15Qty,
                        },
                    })
                    await this.inventory.activateReservationLine(tx, {
                        reservationLineId: reservationLine.id,
                        actualQty: takeQty,
                        v15Qty: requestedV15Qty,
                        idempotencyKey: `sales-order:${orderId}:fifo:${reservationLine.id}`,
                        occurredAt: new Date(),
                        actorId: actor.userId,
                        reason: `Giữ FIFO lô ${candidate.lot.lotNo} cho đơn bán ${order.orderNo}`,
                    })
                    allocations.push({
                        inventoryLotId: candidate.inventoryLotId,
                        lotNo: candidate.lot.lotNo,
                        supplierPartyId: candidate.lot.supplier.id,
                        supplierCode: candidate.lot.supplier.code,
                        supplierName: candidate.lot.supplier.name,
                        releaseCode: candidate.lot.releaseCode,
                        actualQty: takeQty.toString(),
                    })
                    missing = missing.minus(takeQty)
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
                allocations,
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

    /**
     * Quản lý kho có thể đổi mã NCC bằng cách chọn lô khác trước khi xuất. Toàn bộ
     * lượng giữ cũ được nhả và giữ lại đúng các lô mới trong cùng giao dịch xác nhận.
     */
    async reallocateSingleDelivery(
        tx: Prisma.TransactionClient,
        deliveryId: string,
        inputs: Array<{
            salesDeliveryLineId: string
            actualQty: number
            v15Qty?: number
            allocations: Array<{ inventoryLotId: string; actualQty: number; v15Qty?: number }>
        }>,
        actor: SalesActor,
    ) {
        const delivery = await tx.salesDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
            include: {
                salesOrder: {
                    select: {
                        id: true,
                        kind: true,
                        orderNo: true,
                        orderDate: true,
                        legalEntityId: true,
                        customerPartyId: true,
                    },
                },
                lines: {
                    include: {
                        orderLine: {
                            select: {
                                id: true,
                                productId: true,
                                supplySource: true,
                                orderedActualQty: true,
                                orderedV15Qty: true,
                            },
                        },
                    },
                },
            },
        })
        if (delivery.salesOrder.kind !== SalesOrderKind.SINGLE) return

        const inputByLine = new Map(inputs.map((line) => [line.salesDeliveryLineId, line]))
        const selectedLotIds = [...new Set(inputs.flatMap((line) => line.allocations.map((row) => row.inventoryLotId)))]
        if (!selectedLotIds.length) throw new BadRequestException({ code: 'SALES_ALLOCATION_REQUIRED' })

        const stock = await tx.stockBalance.findMany({
            where: {
                warehouseId: delivery.warehouseId,
                inventoryLotId: { in: selectedLotIds },
                actualQty: { gt: 0 },
            },
            include: {
                lot: {
                    select: {
                        id: true,
                        lotNo: true,
                        productId: true,
                        releaseCode: true,
                        supplierPartyId: true,
                        supplier: { select: { code: true, name: true } },
                    },
                },
            },
        })
        const stockByLot = new Map(stock.map((row) => [row.inventoryLotId, row]))

        for (const lotId of [...selectedLotIds].sort()) {
            const row = stockByLot.get(lotId)
            if (!row) {
                throw new ConflictException({
                    code: 'SALES_SELECTED_LOT_NOT_AVAILABLE',
                    message: 'Lô đã chọn không còn tồn tại tại kho nhận.',
                    inventoryLotId: lotId,
                })
            }
            const lockKey = `sales-fifo:${row.warehouseId}:${row.productId}:${row.ownerPartyId}:${row.inventoryLotId}`
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
        }

        const oldLines = await tx.inventoryReservationLine.findMany({
            where: {
                salesOrderLineId: { in: delivery.lines.map((line) => line.salesOrderLineId) },
                activeActualQty: { gt: 0 },
                reservation: {
                    salesOrderId: delivery.salesOrder.id,
                    status: {
                        in: [
                            ReservationStatus.DRAFT,
                            ReservationStatus.ACTIVE,
                            ReservationStatus.PARTIALLY_RELEASED,
                        ],
                    },
                },
            },
        })
        for (const line of oldLines) {
            await this.inventory.releaseReservationLine(tx, {
                reservationLineId: line.id,
                actualQty: line.activeActualQty,
                v15Qty: line.activeV15Qty,
                idempotencyKey: `sales-delivery:${deliveryId}:reallocate:release:${line.id}`,
                occurredAt: new Date(),
                actorId: actor.userId,
                reason: `Quản lý kho chọn lại mã NCC/lô cho ${delivery.salesOrder.orderNo}`,
            })
        }

        const [reserved, pending, blocked] = await Promise.all([
            tx.inventoryReservationLine.groupBy({
                by: ['inventoryLotId'],
                where: { inventoryLotId: { in: selectedLotIds }, activeActualQty: { gt: 0 } },
                _sum: { activeActualQty: true },
            }),
            tx.inventoryPendingRelease.groupBy({
                by: ['inventoryLotId'],
                where: {
                    inventoryLotId: { in: selectedLotIds },
                    status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
                    activeActualQty: { gt: 0 },
                },
                _sum: { activeActualQty: true },
            }),
            tx.inventoryBlock.groupBy({
                by: ['inventoryLotId'],
                where: {
                    inventoryLotId: { in: selectedLotIds },
                    status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
                    activeActualQty: { gt: 0 },
                },
                _sum: { activeActualQty: true },
            }),
        ])
        const quantityMap = (
            rows: Array<{ inventoryLotId: string | null; _sum: { activeActualQty: Prisma.Decimal | null } }>,
        ) => {
            const result = new Map<string, Prisma.Decimal>()
            for (const row of rows) {
                if (row.inventoryLotId) result.set(row.inventoryLotId, new Prisma.Decimal(row._sum.activeActualQty ?? 0))
            }
            return result
        }
        const reservedByLot = quantityMap(reserved)
        const pendingByLot = quantityMap(pending)
        const blockedByLot = quantityMap(blocked)
        const requestedByLot = new Map<string, Prisma.Decimal>()

        for (const deliveryLine of delivery.lines) {
            const input = inputByLine.get(deliveryLine.id)
            if (!input) throw new BadRequestException({ code: 'SALES_ISSUE_LINE_MISSING' })
            const allocated = input.allocations.reduce(
                (sum, row) => sum.plus(row.actualQty),
                new Prisma.Decimal(0),
            )
            if (!allocated.equals(input.actualQty)) {
                throw new BadRequestException({ code: 'SALES_ISSUE_ALLOCATION_MISMATCH' })
            }
            const duplicateLots = input.allocations.map((row) => row.inventoryLotId)
            if (new Set(duplicateLots).size !== duplicateLots.length) {
                throw new BadRequestException({ code: 'SALES_ISSUE_DUPLICATE_LOT' })
            }
            for (const allocation of input.allocations) {
                const stockRow = stockByLot.get(allocation.inventoryLotId)
                if (
                    !stockRow ||
                    stockRow.productId !== deliveryLine.orderLine.productId ||
                    stockRow.ownerPartyId !== deliveryLine.ownerPartyId ||
                    stockRow.lot.releaseCode !== deliveryLine.orderLine.supplySource ||
                    !stockRow.lot.supplierPartyId
                ) {
                    throw new BadRequestException({
                        code: 'SALES_LOT_SOURCE_MISMATCH',
                        message: 'Lô đã chọn không đúng mặt hàng hoặc nguồn TP/NCC của đơn.',
                        inventoryLotId: allocation.inventoryLotId,
                    })
                }
                requestedByLot.set(
                    allocation.inventoryLotId,
                    (requestedByLot.get(allocation.inventoryLotId) ?? new Prisma.Decimal(0)).plus(allocation.actualQty),
                )
            }
        }

        for (const [lotId, requestedQty] of requestedByLot) {
            const stockRow = stockByLot.get(lotId)!
            const availableQty = new Prisma.Decimal(stockRow.actualQty)
                .minus(reservedByLot.get(lotId) ?? 0)
                .minus(pendingByLot.get(lotId) ?? 0)
                .minus(blockedByLot.get(lotId) ?? 0)
            if (requestedQty.greaterThan(availableQty)) {
                throw new ConflictException({
                    code: 'INSUFFICIENT_SELECTED_SUPPLIER_STOCK',
                    message: `Mã NCC ${stockRow.lot.supplier?.code ?? '—'} không đủ tồn cho lô ${stockRow.lot.lotNo}.`,
                    supplierCode: stockRow.lot.supplier?.code ?? null,
                    inventoryLotId: lotId,
                    requestedQty: requestedQty.toString(),
                    availableQty: availableQty.toString(),
                    shortageQty: requestedQty.minus(availableQty).toString(),
                })
            }
        }

        const fresh = await tx.inventoryReservation.create({
            data: {
                reservationNo: await this.nextReservationNo(tx, delivery.salesOrder.orderDate),
                legalEntityId: delivery.salesOrder.legalEntityId,
                customerPartyId: delivery.salesOrder.customerPartyId,
                salesOrderId: delivery.salesOrder.id,
                expiresAt: null,
                note: `Phân bổ lại tại kho cho ${delivery.salesOrder.orderNo}`,
            },
        })
        let lineNo = 0
        for (const deliveryLine of delivery.lines) {
            const input = inputByLine.get(deliveryLine.id)!
            for (const allocation of input.allocations) {
                const stockRow = stockByLot.get(allocation.inventoryLotId)!
                const actualQty = new Prisma.Decimal(allocation.actualQty)
                const requestedV15Qty =
                    input.v15Qty == null
                        ? null
                        : new Prisma.Decimal(input.v15Qty).times(actualQty).div(input.actualQty)
                const line = await tx.inventoryReservationLine.create({
                    data: {
                        reservationId: fresh.id,
                        lineNo: ++lineNo,
                        warehouseId: delivery.warehouseId,
                        productId: deliveryLine.orderLine.productId,
                        ownerPartyId: stockRow.ownerPartyId,
                        salesOrderLineId: deliveryLine.salesOrderLineId,
                        inventoryLotId: allocation.inventoryLotId,
                        requestedActualQty: actualQty,
                        requestedV15Qty,
                    },
                })
                await this.inventory.activateReservationLine(tx, {
                    reservationLineId: line.id,
                    actualQty,
                    v15Qty: requestedV15Qty,
                    idempotencyKey: `sales-delivery:${deliveryId}:reallocate:activate:${line.id}`,
                    occurredAt: new Date(),
                    actorId: actor.userId,
                    reason: `Kho chọn lô ${stockRow.lot.lotNo}, mã NCC ${stockRow.lot.supplier?.code ?? '—'}`,
                })
            }
        }
    }

    /** Giải phóng toàn bộ lượng đang giữ khi huỷ hoặc đưa đơn về chờ duyệt. */
    async releaseOrder(tx: Prisma.TransactionClient, orderId: string, actor: SalesActor, reason: string) {
        const reservations = await tx.inventoryReservation.findMany({
            where: {
                salesOrderId: orderId,
                status: {
                    in: [
                        ReservationStatus.DRAFT,
                        ReservationStatus.ACTIVE,
                        ReservationStatus.PARTIALLY_RELEASED,
                    ],
                },
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
