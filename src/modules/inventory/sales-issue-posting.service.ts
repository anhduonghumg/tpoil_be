import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { InventoryPostingKind, Prisma, ReservationStatus } from '@prisma/client'
import { InventoryCoreService } from './inventory-core.service'
import { PurchaseTermCostLayerService } from 'src/modules/purchases/purchase-term/purchase-term-cost-layer.service'

export type IssueLotAllocationInput = {
    inventoryLotId: string
    actualQty: Prisma.Decimal | number | string
    v15Qty?: Prisma.Decimal | number | string | null
}

export type IssueLineInput = {
    salesDeliveryLineId: string
    actualQty: Prisma.Decimal | number | string
    v15Qty?: Prisma.Decimal | number | string | null
    temperatureC?: Prisma.Decimal | number | string | null
    vcf?: Prisma.Decimal | number | string | null
    allocations: IssueLotAllocationInput[]
}

/**
 * Posts a warehouse's confirmed issue for one SalesDelivery.
 *
 * ORDER MATTERS (spec v1.2 P0-1): the hold must be consumed BEFORE stock is reduced.
 * InventoryCoreService.post asserts `onHand − reserved − pending − blocked >= 0` right
 * after lowering onHand, so posting first would fail for every fully held order.
 */
@Injectable()
export class SalesIssuePostingService {
    constructor(
        private readonly inventory: InventoryCoreService,
        private readonly costLayers: PurchaseTermCostLayerService,
    ) {}

    private decimal(value: Prisma.Decimal | number | string | null | undefined) {
        return new Prisma.Decimal(value ?? 0)
    }

    private async lock(tx: Prisma.TransactionClient, keys: string[]) {
        for (const key of [...new Set(keys)].sort()) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
        }
    }

    async post(
        tx: Prisma.TransactionClient,
        args: {
            salesDeliveryId: string
            lines: IssueLineInput[]
            issueDocNo?: string | null
            effectiveAt: Date
            actorId?: string | null
        },
    ) {
        const delivery = await tx.salesDelivery.findUniqueOrThrow({
            where: { id: args.salesDeliveryId },
            include: {
                salesOrder: { select: { id: true, orderNo: true, kind: true } },
                lines: {
                    include: {
                        orderLine: { select: { id: true, lineNo: true, productId: true } },
                    },
                },
            },
        })

        // 1) Locks, in a fixed order shared by every sales confirm.
        await this.lock(tx, [
            `sales-delivery:${delivery.id}`,
            `sales-order:${delivery.salesOrderId}`,
            ...delivery.lines.map((line) => `sales-order-line:${line.salesOrderLineId}`),
        ])

        const inputByLine = new Map(args.lines.map((line) => [line.salesDeliveryLineId, line]))
        const postingLines: Array<{
            warehouseId: string
            productId: string
            ownerPartyId: string
            inventoryLotId: string
            actualQtyDelta: Prisma.Decimal
            v15QtyDelta: Prisma.Decimal | null
        }> = []
        const costAllocations: Array<{
            salesDeliveryLineId: string
            inventoryLotId: string
            ownerPartyId: string
            actualQty: Prisma.Decimal
        }> = []

        for (const deliveryLine of delivery.lines) {
            const input = inputByLine.get(deliveryLine.id)
            if (!input) {
                throw new BadRequestException({
                    code: 'SALES_ISSUE_LINE_MISSING',
                    message: `Thiếu số thực xuất cho dòng ${deliveryLine.lineNo}.`,
                })
            }
            const actualQty = this.decimal(input.actualQty)
            if (!actualQty.greaterThan(0)) {
                throw new BadRequestException({
                    code: 'SALES_ISSUE_QTY_INVALID',
                    message: `Dòng ${deliveryLine.lineNo}: số thực xuất phải lớn hơn 0.`,
                })
            }
            const allocated = input.allocations.reduce(
                (sum, allocation) => sum.plus(this.decimal(allocation.actualQty)),
                new Prisma.Decimal(0),
            )
            if (!allocated.equals(actualQty)) {
                throw new BadRequestException({
                    code: 'SALES_ISSUE_ALLOCATION_MISMATCH',
                    message: `Dòng ${deliveryLine.lineNo}: tổng phân bổ theo lô (${allocated}) khác số thực xuất (${actualQty}).`,
                })
            }

            for (const allocation of input.allocations) {
                const qty = this.decimal(allocation.actualQty)
                if (!qty.greaterThan(0)) {
                    throw new BadRequestException({
                        code: 'SALES_ISSUE_ALLOCATION_QTY_INVALID',
                        message: `Dòng ${deliveryLine.lineNo}: số lượng theo lô phải lớn hơn 0.`,
                    })
                }
                postingLines.push({
                    warehouseId: delivery.warehouseId,
                    productId: deliveryLine.orderLine.productId,
                    ownerPartyId: deliveryLine.ownerPartyId,
                    inventoryLotId: allocation.inventoryLotId,
                    // Sales issue reduces stock: post() does NOT flip the sign by kind.
                    actualQtyDelta: qty.negated(),
                    v15QtyDelta:
                        allocation.v15Qty == null ? null : this.decimal(allocation.v15Qty).negated(),
                })
                costAllocations.push({
                    salesDeliveryLineId: deliveryLine.id,
                    inventoryLotId: allocation.inventoryLotId,
                    ownerPartyId: deliveryLine.ownerPartyId,
                    actualQty: qty,
                })
            }
        }

        // 2) Value the picked lots before touching stock, so a cost problem aborts early.
        await this.costLayers.previewConsumeInTx(tx, costAllocations)

        // 3) Consume the hold FIRST (see class comment), then release whatever was held over.
        // The hold belongs to whichever document raised this job: a LOT draw holds against
        // its withdrawal request, a SINGLE order against the order itself (spec v1.2 §3.3).
        const reservationLines = await tx.inventoryReservationLine.findMany({
            where: {
                salesOrderLineId: { in: delivery.lines.map((line) => line.salesOrderLineId) },
                reservation: {
                    ...(delivery.withdrawalRequestId
                        ? { withdrawalRequestId: delivery.withdrawalRequestId }
                        : { salesOrderId: delivery.salesOrderId }),
                    status: { in: [ReservationStatus.DRAFT, ReservationStatus.ACTIVE, ReservationStatus.PARTIALLY_RELEASED] },
                },
            },
        })
        const reservationByOrderLine = new Map(
            reservationLines.map((line) => [line.salesOrderLineId, line]),
        )

        // Luồng cũ chỉ hỗ trợ một dòng giữ tổng cho mỗi dòng đơn. Giữ lại để tương thích
        // kiểu dữ liệu, nhưng không chạy vì phân bổ mới luôn giữ chi tiết theo từng lô.
        for (const deliveryLine of [] as typeof delivery.lines) {
            const input = inputByLine.get(deliveryLine.id)!
            const actualQty = this.decimal(input.actualQty)
            const reservationLine = reservationByOrderLine.get(deliveryLine.salesOrderLineId)
            if (!reservationLine) continue

            const held = this.decimal(reservationLine.activeActualQty)
            if (actualQty.greaterThan(held)) {
                // D7: never post beyond what was held — the warehouse returns the job instead.
                throw new ConflictException({
                    code: 'SALES_ISSUE_EXCEEDS_RESERVED_QTY',
                    message: `Dòng ${deliveryLine.lineNo}: thực xuất ${actualQty} vượt lượng đã giữ ${held}. Hãy trả lại để Sale điều chỉnh đơn.`,
                    reservedQty: held.toString(),
                    issuedQty: actualQty.toString(),
                })
            }
            await this.inventory.consumeReservationLine(tx, {
                reservationLineId: reservationLine.id,
                actualQty,
                v15Qty: input.v15Qty ?? null,
                idempotencyKey: `sales-delivery:${delivery.id}:consume:${deliveryLine.id}`,
                occurredAt: args.effectiveAt,
                actorId: args.actorId,
                reason: `Xuất bán ${delivery.deliveryNo}`,
            })

            const leftover = held.minus(actualQty)
            if (leftover.greaterThan(0)) {
                await this.inventory.releaseReservationLine(tx, {
                    reservationLineId: reservationLine.id,
                    actualQty: leftover,
                    v15Qty: null,
                    idempotencyKey: `sales-delivery:${delivery.id}:release-leftover:${deliveryLine.id}`,
                    occurredAt: args.effectiveAt,
                    actorId: args.actorId,
                    reason: `Giải phóng phần giữ thừa của ${delivery.deliveryNo}`,
                })
            }
        }

        for (const deliveryLine of delivery.lines) {
            const input = inputByLine.get(deliveryLine.id)!
            const actualQty = this.decimal(input.actualQty)
            const heldLines = reservationLines.filter(
                (line) =>
                    line.salesOrderLineId === deliveryLine.salesOrderLineId &&
                    this.decimal(line.activeActualQty).greaterThan(0),
            )
            const held = heldLines.reduce(
                (sum, line) => sum.plus(line.activeActualQty),
                new Prisma.Decimal(0),
            )
            if (actualQty.greaterThan(held)) {
                throw new ConflictException({
                    code: 'SALES_ISSUE_EXCEEDS_RESERVED_QTY',
                    message: `Dòng ${deliveryLine.lineNo}: thực xuất ${actualQty} vượt lượng đã giữ ${held}.`,
                    reservedQty: held.toString(),
                    issuedQty: actualQty.toString(),
                })
            }

            const consumedByReservation = new Map<string, Prisma.Decimal>()
            for (const allocation of input.allocations) {
                let remaining = this.decimal(allocation.actualQty)
                const matching = heldLines.filter(
                    (line) => line.inventoryLotId === allocation.inventoryLotId,
                )
                for (const reservationLine of matching) {
                    if (!remaining.greaterThan(0)) break
                    const activeQty = this.decimal(reservationLine.activeActualQty)
                    const alreadyConsumed = consumedByReservation.get(reservationLine.id) ?? new Prisma.Decimal(0)
                    const headroom = activeQty.minus(alreadyConsumed)
                    const takeQty = Prisma.Decimal.min(remaining, headroom)
                    if (!takeQty.greaterThan(0)) continue
                    const takeV15 =
                        reservationLine.activeV15Qty == null
                            ? null
                            : this.decimal(reservationLine.activeV15Qty).times(takeQty).div(activeQty)
                    await this.inventory.consumeReservationLine(tx, {
                        reservationLineId: reservationLine.id,
                        actualQty: takeQty,
                        v15Qty: takeV15,
                        idempotencyKey: `sales-delivery:${delivery.id}:consume:${deliveryLine.id}:${reservationLine.id}`,
                        occurredAt: args.effectiveAt,
                        actorId: args.actorId,
                        reason: `Xuất bán ${delivery.deliveryNo}`,
                    })
                    consumedByReservation.set(reservationLine.id, alreadyConsumed.plus(takeQty))
                    remaining = remaining.minus(takeQty)
                }
                if (remaining.greaterThan(0)) {
                    throw new ConflictException({
                        code: 'SALES_ISSUE_LOT_NOT_RESERVED',
                        message: `Dòng ${deliveryLine.lineNo}: lô được chọn chưa được giữ đủ số lượng.`,
                        inventoryLotId: allocation.inventoryLotId,
                        shortageQty: remaining.toString(),
                    })
                }
            }

            for (const reservationLine of heldLines) {
                const consumed = consumedByReservation.get(reservationLine.id) ?? new Prisma.Decimal(0)
                const leftover = this.decimal(reservationLine.activeActualQty).minus(consumed)
                if (!leftover.greaterThan(0)) continue
                const leftoverV15 =
                    reservationLine.activeV15Qty == null
                        ? null
                        : this.decimal(reservationLine.activeV15Qty)
                              .times(leftover)
                              .div(reservationLine.activeActualQty)
                await this.inventory.releaseReservationLine(tx, {
                    reservationLineId: reservationLine.id,
                    actualQty: leftover,
                    v15Qty: leftoverV15,
                    idempotencyKey: `sales-delivery:${delivery.id}:release-leftover:${deliveryLine.id}:${reservationLine.id}`,
                    occurredAt: args.effectiveAt,
                    actorId: args.actorId,
                    reason: `Giải phóng phần giữ thừa của ${delivery.deliveryNo}`,
                })
            }
        }

        // 4) Record which lots went out, then move physical stock.
        for (const deliveryLine of delivery.lines) {
            const input = inputByLine.get(deliveryLine.id)!
            for (const allocation of input.allocations) {
                await tx.salesDeliveryLotAllocation.upsert({
                    where: {
                        salesDeliveryLineId_inventoryLotId: {
                            salesDeliveryLineId: deliveryLine.id,
                            inventoryLotId: allocation.inventoryLotId,
                        },
                    },
                    create: {
                        salesDeliveryLineId: deliveryLine.id,
                        inventoryLotId: allocation.inventoryLotId,
                        ownerPartyId: deliveryLine.ownerPartyId,
                        actualQty: this.decimal(allocation.actualQty),
                        v15Qty: allocation.v15Qty == null ? null : this.decimal(allocation.v15Qty),
                    },
                    update: {},
                })
            }
            await tx.salesDeliveryLine.update({
                where: { id: deliveryLine.id },
                data: {
                    actualQty: this.decimal(input.actualQty),
                    v15Qty: input.v15Qty == null ? null : this.decimal(input.v15Qty),
                    temperatureC: input.temperatureC == null ? null : this.decimal(input.temperatureC),
                    vcf: input.vcf == null ? null : this.decimal(input.vcf),
                    postedAt: args.effectiveAt,
                },
            })
        }

        const posting = await this.inventory.post(tx, {
            postingNo: `SI-${delivery.deliveryNo}`,
            kind: InventoryPostingKind.SALES_ISSUE,
            idempotencyKey: `sales-delivery:${delivery.id}:post`,
            effectiveAt: args.effectiveAt,
            postedById: args.actorId,
            source: { salesDeliveryId: delivery.id },
            lines: postingLines,
        })

        // 5) Cost follows the very same lots.
        const costResult = await this.costLayers.commitConsumeInTx(tx, costAllocations, args.effectiveAt)

        return { posting, costResult }
    }

    /**
     * Correction (spec v1.2 §9): undo stock and cost, keeping every ledger append-only.
     * The reservation is NOT restored — a revision takes a fresh hold instead (P0-5).
     */
    async reverse(
        tx: Prisma.TransactionClient,
        args: { salesDeliveryId: string; effectiveAt: Date; actorId?: string | null },
    ) {
        const delivery = await tx.salesDelivery.findUniqueOrThrow({
            where: { id: args.salesDeliveryId },
            include: { lines: { select: { id: true } } },
        })
        const original = await tx.inventoryPosting.findUnique({
            where: { salesDeliveryId: args.salesDeliveryId },
            select: { id: true, postingNo: true, status: true },
        })

        const lineIds = delivery.lines.map((line) => line.id)
        await this.costLayers.reverseConsumeInTx(tx, lineIds, args.effectiveAt)

        if (!original || original.status !== 'POSTED') return null
        return this.inventory.reverse(tx, {
            postingId: original.id,
            postingNo: `${original.postingNo}-REV`,
            idempotencyKey: `sales-delivery:${args.salesDeliveryId}:reverse`,
            effectiveAt: args.effectiveAt,
            postedById: args.actorId,
        })
    }

    /** FIFO proposal the warehouse may override; the picked lots are what actually count. */
    async suggestAllocations(
        tx: Prisma.TransactionClient,
        args: {
            warehouseId: string
            productId: string
            ownerPartyId: string
            salesOrderLineId: string
            supplySource: 'TP' | 'NCC'
            actualQty: Prisma.Decimal
        },
    ) {
        const balances = await tx.stockBalance.findMany({
            where: {
                warehouseId: args.warehouseId,
                productId: args.productId,
                ownerPartyId: args.ownerPartyId,
                actualQty: { gt: 0 },
                lot: {
                    releaseCode: args.supplySource,
                    supplierPartyId: { not: null },
                },
            },
            include: {
                lot: {
                    select: {
                        id: true,
                        lotNo: true,
                        receivedAt: true,
                        releaseCode: true,
                        supplier: { select: { id: true, code: true, name: true } },
                    },
                },
            },
            orderBy: [{ lot: { receivedAt: 'asc' } }, { lot: { lotNo: 'asc' } }],
        })

        const lotIds = balances.map((row) => row.inventoryLotId)
        const [reserved, ownHeld, pending, blocked] = lotIds.length
            ? await Promise.all([
                  tx.inventoryReservationLine.groupBy({
                      by: ['inventoryLotId'],
                      where: { inventoryLotId: { in: lotIds }, activeActualQty: { gt: 0 } },
                      _sum: { activeActualQty: true },
                  }),
                  tx.inventoryReservationLine.groupBy({
                      by: ['inventoryLotId'],
                      where: {
                          inventoryLotId: { in: lotIds },
                          salesOrderLineId: args.salesOrderLineId,
                          activeActualQty: { gt: 0 },
                      },
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
            : [[], [], [], []]
        const sumMap = (rows: Array<{ inventoryLotId: string | null; _sum: { activeActualQty: Prisma.Decimal | null } }>) => {
            const result = new Map<string, Prisma.Decimal>()
            for (const row of rows) {
                if (row.inventoryLotId) result.set(row.inventoryLotId, this.decimal(row._sum.activeActualQty))
            }
            return result
        }
        const reservedByLot = sumMap(reserved)
        const ownHeldByLot = sumMap(ownHeld)
        const pendingByLot = sumMap(pending)
        const blockedByLot = sumMap(blocked)
        const availableForOrder = new Map(
            balances.map((balance) => [
                balance.inventoryLotId,
                Prisma.Decimal.max(
                    this.decimal(balance.actualQty)
                        .minus(reservedByLot.get(balance.inventoryLotId) ?? 0)
                        .minus(pendingByLot.get(balance.inventoryLotId) ?? 0)
                        .minus(blockedByLot.get(balance.inventoryLotId) ?? 0)
                        .plus(ownHeldByLot.get(balance.inventoryLotId) ?? 0),
                    0,
                ),
            ]),
        )

        const suggestion: Array<{
            inventoryLotId: string
            lotNo: string
            supplierPartyId: string
            supplierCode: string
            supplierName: string
            releaseCode: 'TP' | 'NCC'
            actualQty: string
            availableQty: string
        }> = []
        let remaining = args.actualQty
        const orderedBalances = [...balances].sort((a, b) => {
            const aHeld = ownHeldByLot.get(a.inventoryLotId)?.greaterThan(0) ? 0 : 1
            const bHeld = ownHeldByLot.get(b.inventoryLotId)?.greaterThan(0) ? 0 : 1
            return aHeld - bHeld || a.lot.receivedAt.getTime() - b.lot.receivedAt.getTime() || a.lot.lotNo.localeCompare(b.lot.lotNo)
        })
        for (const balance of orderedBalances) {
            if (!remaining.greaterThan(0)) break
            if (!balance.lot.supplier || !balance.lot.releaseCode) continue
            const availableQty = availableForOrder.get(balance.inventoryLotId) ?? new Prisma.Decimal(0)
            const preferredQty = ownHeldByLot.get(balance.inventoryLotId) ?? availableQty
            const take = Prisma.Decimal.min(remaining, preferredQty, availableQty)
            if (!take.greaterThan(0)) continue
            suggestion.push({
                inventoryLotId: balance.inventoryLotId,
                lotNo: balance.lot.lotNo,
                supplierPartyId: balance.lot.supplier.id,
                supplierCode: balance.lot.supplier.code,
                supplierName: balance.lot.supplier.name,
                releaseCode: balance.lot.releaseCode,
                actualQty: take.toString(),
                availableQty: availableQty.toString(),
            })
            remaining = remaining.minus(take)
        }
        // Thực xuất có thể khác kế hoạch (hao hụt, xuất thêm), nên kho phải thấy được
        // mọi lô còn hàng chứ không chỉ phần FIFO vừa đủ kế hoạch.
        const availableLots = balances
            .filter((balance) => balance.lot.supplier && balance.lot.releaseCode)
            .map((balance) => ({
                inventoryLotId: balance.inventoryLotId,
                lotNo: balance.lot.lotNo,
                receivedAt: balance.lot.receivedAt,
                supplierPartyId: balance.lot.supplier!.id,
                supplierCode: balance.lot.supplier!.code,
                supplierName: balance.lot.supplier!.name,
                releaseCode: balance.lot.releaseCode!,
                availableQty: (availableForOrder.get(balance.inventoryLotId) ?? 0).toString(),
            }))
        return { suggestion, shortageQty: remaining.toString(), availableLots }
    }
}
