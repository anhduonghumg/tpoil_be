import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import {
    InventoryPostingKind,
    InventoryPostingStatus,
    Prisma,
    ReservationEventType,
    ReservationStatus,
    RestrictionEventType,
    RestrictionStatus,
} from '@prisma/client'

type DecimalLike = Prisma.Decimal | number | string

export type InventoryPostingLineInput = {
    warehouseId: string
    productId: string
    ownerPartyId: string
    inventoryLotId: string
    actualQtyDelta: DecimalLike
    v15QtyDelta?: DecimalLike | null
}

export type InventoryPostingSource = {
    goodsReceiptId?: string
    movementDispatchId?: string
    movementArrivalId?: string
    ownershipTransferId?: string
    stockAdjustmentId?: string
    salesDeliveryId?: string
}

type RestrictionKind = 'PENDING_RELEASE' | 'BLOCK'

@Injectable()
export class InventoryCoreService {
    private decimal(value: DecimalLike | null | undefined) {
        return new Prisma.Decimal(value ?? 0)
    }

    private availabilityKey(warehouseId: string, productId: string, ownerPartyId: string) {
        return `${warehouseId}:${productId}:${ownerPartyId}`
    }

    private balanceKey(line: InventoryPostingLineInput) {
        return `${this.availabilityKey(line.warehouseId, line.productId, line.ownerPartyId)}:${line.inventoryLotId}`
    }

    private assertSingleSource(source: InventoryPostingSource) {
        const sourceIds = Object.values(source).filter(Boolean)
        if (sourceIds.length !== 1) {
            throw new BadRequestException({
                code: 'INVENTORY_POSTING_REQUIRES_ONE_SOURCE',
                message: 'Bút toán kho phải gắn với đúng một chứng từ nguồn.',
            })
        }
    }

    private async lockKeys(tx: Prisma.TransactionClient, keys: string[]) {
        for (const key of [...new Set(keys)].sort()) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
        }
    }

    private aggregateLines(lines: InventoryPostingLineInput[]) {
        const aggregated = new Map<
            string,
            InventoryPostingLineInput & {
                actualQtyDelta: Prisma.Decimal
                v15QtyDelta: Prisma.Decimal | null
            }
        >()

        for (const line of lines) {
            const actualQtyDelta = this.decimal(line.actualQtyDelta)
            const v15QtyDelta = line.v15QtyDelta == null ? null : this.decimal(line.v15QtyDelta)
            if (actualQtyDelta.isZero() && (v15QtyDelta == null || v15QtyDelta.isZero())) continue

            const key = this.balanceKey(line)
            const current = aggregated.get(key)
            if (!current) {
                aggregated.set(key, { ...line, actualQtyDelta, v15QtyDelta })
                continue
            }

            current.actualQtyDelta = current.actualQtyDelta.plus(actualQtyDelta)
            current.v15QtyDelta =
                current.v15QtyDelta == null && v15QtyDelta == null
                    ? null
                    : this.decimal(current.v15QtyDelta).plus(this.decimal(v15QtyDelta))
        }

        return [...aggregated.values()].filter(
            (line) => !line.actualQtyDelta.isZero() || (line.v15QtyDelta != null && !line.v15QtyDelta.isZero()),
        )
    }

    private assertAvailabilityInvariant(balance: {
        onHandActualQty: DecimalLike
        reservedActualQty: DecimalLike
        pendingActualQty: DecimalLike
        blockedActualQty: DecimalLike
        onHandV15Qty?: DecimalLike | null
        reservedV15Qty?: DecimalLike | null
        pendingV15Qty?: DecimalLike | null
        blockedV15Qty?: DecimalLike | null
    }) {
        const onHand = this.decimal(balance.onHandActualQty)
        const reserved = this.decimal(balance.reservedActualQty)
        const pending = this.decimal(balance.pendingActualQty)
        const blocked = this.decimal(balance.blockedActualQty)
        const available = onHand.minus(reserved).minus(pending).minus(blocked)

        if ([onHand, reserved, pending, blocked, available].some((value) => value.isNegative())) {
            throw new ConflictException({
                code: 'INVENTORY_AVAILABILITY_INVARIANT_VIOLATION',
                message: 'Tổng giữ hàng, chờ giải phóng và khóa không được vượt tồn thực tế.',
                onHand: onHand.toString(),
                reserved: reserved.toString(),
                pending: pending.toString(),
                blocked: blocked.toString(),
                available: available.toString(),
            })
        }

        const hasV15 = [
            balance.onHandV15Qty,
            balance.reservedV15Qty,
            balance.pendingV15Qty,
            balance.blockedV15Qty,
        ].some((value) => value != null)
        if (hasV15) {
            const onHandV15 = this.decimal(balance.onHandV15Qty)
            const reservedV15 = this.decimal(balance.reservedV15Qty)
            const pendingV15 = this.decimal(balance.pendingV15Qty)
            const blockedV15 = this.decimal(balance.blockedV15Qty)
            const availableV15 = onHandV15.minus(reservedV15).minus(pendingV15).minus(blockedV15)
            if ([onHandV15, reservedV15, pendingV15, blockedV15, availableV15].some((value) => value.isNegative())) {
                throw new ConflictException({
                    code: 'INVENTORY_V15_AVAILABILITY_INVARIANT_VIOLATION',
                    message: 'Tổng giữ hàng, chờ giải phóng và khóa theo V15 không được vượt tồn thực tế.',
                })
            }
        }
    }

    async post(
        tx: Prisma.TransactionClient,
        args: {
            postingNo: string
            kind: InventoryPostingKind
            idempotencyKey: string
            effectiveAt: Date
            postedById?: string | null
            source: InventoryPostingSource
            lines: InventoryPostingLineInput[]
        },
    ) {
        this.assertSingleSource(args.source)

        const existing = await tx.inventoryPosting.findUnique({
            where: { idempotencyKey: args.idempotencyKey },
            include: { entries: true },
        })
        if (existing) return existing

        const lines = this.aggregateLines(args.lines)
        if (!lines.length) {
            throw new BadRequestException({
                code: 'INVENTORY_POSTING_EMPTY',
                message: 'Bút toán kho phải có ít nhất một dòng số lượng khác 0.',
            })
        }

        await this.lockKeys(tx, [
            ...lines.map((line) => `stock:${this.balanceKey(line)}`),
            ...lines.map(
                (line) =>
                    `availability:${this.availabilityKey(line.warehouseId, line.productId, line.ownerPartyId)}`,
            ),
        ])

        const lots = await tx.inventoryLot.findMany({
            where: { id: { in: [...new Set(lines.map((line) => line.inventoryLotId))] } },
            select: { id: true, productId: true },
        })
        const lotProducts = new Map(lots.map((lot) => [lot.id, lot.productId]))
        for (const line of lines) {
            if (lotProducts.get(line.inventoryLotId) !== line.productId) {
                throw new BadRequestException({
                    code: 'INVENTORY_LOT_PRODUCT_MISMATCH',
                    message: 'Lô hàng không thuộc mặt hàng trên dòng bút toán.',
                    inventoryLotId: line.inventoryLotId,
                    productId: line.productId,
                })
            }
        }

        const posting = await tx.inventoryPosting.create({
            data: {
                postingNo: args.postingNo,
                kind: args.kind,
                status: InventoryPostingStatus.POSTED,
                idempotencyKey: args.idempotencyKey,
                effectiveAt: args.effectiveAt,
                postedById: args.postedById ?? null,
                ...args.source,
                entries: {
                    create: lines.map((line, index) => ({
                        lineNo: index + 1,
                        warehouseId: line.warehouseId,
                        productId: line.productId,
                        ownerPartyId: line.ownerPartyId,
                        inventoryLotId: line.inventoryLotId,
                        actualQtyDelta: line.actualQtyDelta,
                        v15QtyDelta: line.v15QtyDelta,
                        effectiveAt: args.effectiveAt,
                    })),
                },
            },
            include: { entries: true },
        })

        const availabilityDeltas = new Map<
            string,
            { line: (typeof lines)[number]; actualQtyDelta: Prisma.Decimal; v15QtyDelta: Prisma.Decimal | null }
        >()
        for (const line of lines) {
            const stock = await tx.stockBalance.upsert({
                where: {
                    warehouseId_productId_ownerPartyId_inventoryLotId: {
                        warehouseId: line.warehouseId,
                        productId: line.productId,
                        ownerPartyId: line.ownerPartyId,
                        inventoryLotId: line.inventoryLotId,
                    },
                },
                create: {
                    warehouseId: line.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                    inventoryLotId: line.inventoryLotId,
                },
                update: {},
            })

            const actualQty = this.decimal(stock.actualQty).plus(line.actualQtyDelta)
            const v15Qty =
                stock.v15Qty == null && line.v15QtyDelta == null
                    ? null
                    : this.decimal(stock.v15Qty).plus(this.decimal(line.v15QtyDelta))
            if (actualQty.isNegative() || (v15Qty != null && v15Qty.isNegative())) {
                throw new ConflictException({
                    code: 'INSUFFICIENT_STOCK',
                    message: 'Không đủ tồn kho theo chủ sở hữu và lô hàng.',
                    warehouseId: line.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                    inventoryLotId: line.inventoryLotId,
                })
            }

            await tx.stockBalance.update({
                where: { id: stock.id },
                data: { actualQty, v15Qty, version: { increment: 1 } },
            })

            const key = this.availabilityKey(line.warehouseId, line.productId, line.ownerPartyId)
            const current = availabilityDeltas.get(key)
            if (current) {
                current.actualQtyDelta = current.actualQtyDelta.plus(line.actualQtyDelta)
                current.v15QtyDelta =
                    current.v15QtyDelta == null && line.v15QtyDelta == null
                        ? null
                        : this.decimal(current.v15QtyDelta).plus(this.decimal(line.v15QtyDelta))
            } else {
                availabilityDeltas.set(key, {
                    line,
                    actualQtyDelta: line.actualQtyDelta,
                    v15QtyDelta: line.v15QtyDelta,
                })
            }
        }

        for (const { line, actualQtyDelta, v15QtyDelta } of availabilityDeltas.values()) {
            const availability = await tx.inventoryAvailabilityBalance.upsert({
                where: {
                    warehouseId_productId_ownerPartyId: {
                        warehouseId: line.warehouseId,
                        productId: line.productId,
                        ownerPartyId: line.ownerPartyId,
                    },
                },
                create: {
                    warehouseId: line.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                },
                update: {},
            })
            const onHandActualQty = this.decimal(availability.onHandActualQty).plus(actualQtyDelta)
            const onHandV15Qty =
                availability.onHandV15Qty == null && v15QtyDelta == null
                    ? null
                    : this.decimal(availability.onHandV15Qty).plus(this.decimal(v15QtyDelta))
            this.assertAvailabilityInvariant({ ...availability, onHandActualQty, onHandV15Qty })
            await tx.inventoryAvailabilityBalance.update({
                where: { id: availability.id },
                data: { onHandActualQty, onHandV15Qty, version: { increment: 1 } },
            })
        }

        return posting
    }

    async reverse(
        tx: Prisma.TransactionClient,
        args: {
            postingId: string
            postingNo: string
            idempotencyKey: string
            effectiveAt: Date
            postedById?: string | null
        },
    ) {
        const existing = await tx.inventoryPosting.findUnique({
            where: { idempotencyKey: args.idempotencyKey },
            include: { entries: true },
        })
        if (existing) return existing

        const original = await tx.inventoryPosting.findUnique({
            where: { id: args.postingId },
            include: { entries: true, reversedBy: true },
        })
        if (!original || original.status !== InventoryPostingStatus.POSTED) {
            throw new BadRequestException({
                code: 'INVENTORY_POSTING_NOT_REVERSIBLE',
                message: 'Bút toán kho không tồn tại hoặc không còn hiệu lực.',
            })
        }
        if (original.reversedBy) return original.reversedBy

        await this.lockKeys(tx, [
            ...original.entries.map(
                (line) =>
                    `stock:${line.warehouseId}:${line.productId}:${line.ownerPartyId}:${line.inventoryLotId}`,
            ),
            ...original.entries.map(
                (line) => `availability:${line.warehouseId}:${line.productId}:${line.ownerPartyId}`,
            ),
        ])

        const posting = await tx.inventoryPosting.create({
            data: {
                postingNo: args.postingNo,
                kind: InventoryPostingKind.REVERSAL,
                status: InventoryPostingStatus.POSTED,
                idempotencyKey: args.idempotencyKey,
                effectiveAt: args.effectiveAt,
                postedById: args.postedById ?? null,
                reversalOfId: original.id,
                entries: {
                    create: original.entries.map((line, index) => ({
                        lineNo: index + 1,
                        warehouseId: line.warehouseId,
                        productId: line.productId,
                        ownerPartyId: line.ownerPartyId,
                        inventoryLotId: line.inventoryLotId,
                        actualQtyDelta: line.actualQtyDelta.negated(),
                        v15QtyDelta: line.v15QtyDelta?.negated() ?? null,
                        effectiveAt: args.effectiveAt,
                    })),
                },
            },
            include: { entries: true },
        })

        await tx.inventoryPosting.update({
            where: { id: original.id },
            data: { status: InventoryPostingStatus.REVERSED },
        })

        for (const line of posting.entries) {
            const stock = await tx.stockBalance.findUniqueOrThrow({
                where: {
                    warehouseId_productId_ownerPartyId_inventoryLotId: {
                        warehouseId: line.warehouseId,
                        productId: line.productId,
                        ownerPartyId: line.ownerPartyId,
                        inventoryLotId: line.inventoryLotId,
                    },
                },
            })
            const actualQty = this.decimal(stock.actualQty).plus(line.actualQtyDelta)
            const v15Qty =
                stock.v15Qty == null && line.v15QtyDelta == null
                    ? null
                    : this.decimal(stock.v15Qty).plus(this.decimal(line.v15QtyDelta))
            if (actualQty.isNegative() || (v15Qty != null && v15Qty.isNegative())) {
                throw new ConflictException({
                    code: 'INVENTORY_REVERSAL_HAS_DOWNSTREAM_USAGE',
                    message: 'Không thể đảo vì hàng đã được sử dụng bởi nghiệp vụ phía sau.',
                })
            }
            await tx.stockBalance.update({
                where: { id: stock.id },
                data: { actualQty, v15Qty, version: { increment: 1 } },
            })
        }

        const availabilityDeltas = new Map<
            string,
            {
                entry: (typeof posting.entries)[number]
                actualDelta: Prisma.Decimal
                v15Delta: Prisma.Decimal | null
            }
        >()
        for (const entry of posting.entries) {
            const key = this.availabilityKey(entry.warehouseId, entry.productId, entry.ownerPartyId)
            const current = availabilityDeltas.get(key)
            if (current) {
                current.actualDelta = current.actualDelta.plus(entry.actualQtyDelta)
                current.v15Delta =
                    current.v15Delta == null && entry.v15QtyDelta == null
                        ? null
                        : this.decimal(current.v15Delta).plus(this.decimal(entry.v15QtyDelta))
            } else {
                availabilityDeltas.set(key, {
                    entry,
                    actualDelta: entry.actualQtyDelta,
                    v15Delta: entry.v15QtyDelta,
                })
            }
        }
        for (const { entry, actualDelta, v15Delta } of availabilityDeltas.values()) {
            const availability = await tx.inventoryAvailabilityBalance.findUniqueOrThrow({
                where: {
                    warehouseId_productId_ownerPartyId: {
                        warehouseId: entry.warehouseId,
                        productId: entry.productId,
                        ownerPartyId: entry.ownerPartyId,
                    },
                },
            })
            const onHandActualQty = this.decimal(availability.onHandActualQty).plus(actualDelta)
            const onHandV15Qty =
                availability.onHandV15Qty == null && v15Delta == null
                    ? null
                    : this.decimal(availability.onHandV15Qty).plus(this.decimal(v15Delta))
            this.assertAvailabilityInvariant({ ...availability, onHandActualQty, onHandV15Qty })
            await tx.inventoryAvailabilityBalance.update({
                where: { id: availability.id },
                data: { onHandActualQty, onHandV15Qty, version: { increment: 1 } },
            })
        }

        return posting
    }

    async activateReservationLine(
        tx: Prisma.TransactionClient,
        args: {
            reservationLineId: string
            actualQty: DecimalLike
            v15Qty?: DecimalLike | null
            idempotencyKey: string
            occurredAt: Date
            actorId?: string | null
            reason?: string | null
        },
    ) {
        const existing = await tx.inventoryReservationEvent.findUnique({
            where: { idempotencyKey: args.idempotencyKey },
        })
        if (existing) return existing

        const line = await tx.inventoryReservationLine.findUniqueOrThrow({
            where: { id: args.reservationLineId },
            include: { reservation: true },
        })
        if (
            line.reservation.status !== ReservationStatus.DRAFT &&
            line.reservation.status !== ReservationStatus.ACTIVE
        ) {
            throw new BadRequestException({
                code: 'RESERVATION_NOT_ACTIVATABLE',
                message: 'Phiếu giữ hàng không ở trạng thái có thể kích hoạt.',
            })
        }

        const actualQty = this.decimal(args.actualQty)
        if (!actualQty.isPositive()) {
            throw new BadRequestException({ code: 'RESERVATION_QTY_MUST_BE_POSITIVE' })
        }
        await this.lockKeys(tx, [
            `availability:${this.availabilityKey(line.warehouseId, line.productId, line.ownerPartyId)}`,
        ])

        const balance = await tx.inventoryAvailabilityBalance.findUnique({
            where: {
                warehouseId_productId_ownerPartyId: {
                    warehouseId: line.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                },
            },
        })
        if (!balance) throw new ConflictException({ code: 'INSUFFICIENT_AVAILABLE_STOCK' })

        const activeActualQty = this.decimal(line.activeActualQty).plus(actualQty)
        if (activeActualQty.greaterThan(line.requestedActualQty)) {
            throw new ConflictException({ code: 'RESERVATION_EXCEEDS_REQUESTED_QTY' })
        }
        const v15Qty = args.v15Qty == null ? null : this.decimal(args.v15Qty)
        if (line.requestedV15Qty == null && v15Qty?.isPositive()) {
            throw new ConflictException({ code: 'RESERVATION_V15_NOT_REQUESTED' })
        }
        if (line.requestedV15Qty != null && !v15Qty?.isPositive()) {
            throw new BadRequestException({ code: 'RESERVATION_V15_QTY_REQUIRED' })
        }
        const activeV15Qty =
            line.activeV15Qty == null && v15Qty == null
                ? null
                : this.decimal(line.activeV15Qty).plus(this.decimal(v15Qty))
        if (line.requestedV15Qty != null && activeV15Qty?.greaterThan(line.requestedV15Qty)) {
            throw new ConflictException({ code: 'RESERVATION_EXCEEDS_REQUESTED_V15_QTY' })
        }

        const reservedActualQty = this.decimal(balance.reservedActualQty).plus(actualQty)
        const reservedV15Qty =
            balance.reservedV15Qty == null && v15Qty == null
                ? null
                : this.decimal(balance.reservedV15Qty).plus(this.decimal(v15Qty))
        this.assertAvailabilityInvariant({ ...balance, reservedActualQty, reservedV15Qty })

        const event = await tx.inventoryReservationEvent.create({
            data: {
                reservationLineId: line.id,
                type: ReservationEventType.ACTIVATE,
                actualQty,
                v15Qty,
                idempotencyKey: args.idempotencyKey,
                occurredAt: args.occurredAt,
                actorId: args.actorId ?? null,
                reason: args.reason ?? null,
            },
        })
        await tx.inventoryReservationLine.update({
            where: { id: line.id },
            data: { activeActualQty, activeV15Qty, version: { increment: 1 } },
        })
        await tx.inventoryAvailabilityBalance.update({
            where: { id: balance.id },
            data: { reservedActualQty, reservedV15Qty, version: { increment: 1 } },
        })
        if (line.reservation.status === ReservationStatus.DRAFT) {
            await tx.inventoryReservation.update({
                where: { id: line.reservationId },
                data: { status: ReservationStatus.ACTIVE, version: { increment: 1 } },
            })
        }
        return event
    }

    async releaseReservationLine(
        tx: Prisma.TransactionClient,
        args: {
            reservationLineId: string
            actualQty: DecimalLike
            v15Qty?: DecimalLike | null
            idempotencyKey: string
            occurredAt: Date
            actorId?: string | null
            reason?: string | null
        },
    ) {
        const existing = await tx.inventoryReservationEvent.findUnique({
            where: { idempotencyKey: args.idempotencyKey },
        })
        if (existing) return existing

        const line = await tx.inventoryReservationLine.findUniqueOrThrow({
            where: { id: args.reservationLineId },
        })
        const actualQty = this.decimal(args.actualQty)
        if (!actualQty.isPositive() || actualQty.greaterThan(line.activeActualQty)) {
            throw new ConflictException({ code: 'RESERVATION_RELEASE_EXCEEDS_ACTIVE_QTY' })
        }

        await this.lockKeys(tx, [
            `availability:${this.availabilityKey(line.warehouseId, line.productId, line.ownerPartyId)}`,
        ])
        const balance = await tx.inventoryAvailabilityBalance.findUniqueOrThrow({
            where: {
                warehouseId_productId_ownerPartyId: {
                    warehouseId: line.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                },
            },
        })
        const activeActualQty = this.decimal(line.activeActualQty).minus(actualQty)
        const releasedActualQty = this.decimal(line.releasedActualQty).plus(actualQty)
        const reservedActualQty = this.decimal(balance.reservedActualQty).minus(actualQty)
        const v15Qty = args.v15Qty == null ? null : this.decimal(args.v15Qty)
        if (this.decimal(line.activeV15Qty).isPositive() && !v15Qty?.isPositive()) {
            throw new BadRequestException({ code: 'RESERVATION_RELEASE_V15_QTY_REQUIRED' })
        }
        if (v15Qty?.greaterThan(this.decimal(line.activeV15Qty))) {
            throw new ConflictException({ code: 'RESERVATION_RELEASE_EXCEEDS_ACTIVE_V15_QTY' })
        }
        const activeV15Qty = line.activeV15Qty == null ? null : this.decimal(line.activeV15Qty).minus(this.decimal(v15Qty))
        const releasedV15Qty =
            line.releasedV15Qty == null && v15Qty == null
                ? null
                : this.decimal(line.releasedV15Qty).plus(this.decimal(v15Qty))
        const reservedV15Qty =
            balance.reservedV15Qty == null
                ? null
                : this.decimal(balance.reservedV15Qty).minus(this.decimal(v15Qty))
        this.assertAvailabilityInvariant({ ...balance, reservedActualQty, reservedV15Qty })

        const event = await tx.inventoryReservationEvent.create({
            data: {
                reservationLineId: line.id,
                type: ReservationEventType.RELEASE,
                actualQty,
                v15Qty,
                idempotencyKey: args.idempotencyKey,
                occurredAt: args.occurredAt,
                actorId: args.actorId ?? null,
                reason: args.reason ?? null,
            },
        })
        await tx.inventoryReservationLine.update({
            where: { id: line.id },
            data: { activeActualQty, activeV15Qty, releasedActualQty, releasedV15Qty, version: { increment: 1 } },
        })
        await tx.inventoryAvailabilityBalance.update({
            where: { id: balance.id },
            data: { reservedActualQty, reservedV15Qty, version: { increment: 1 } },
        })
        return event
    }

    async consumeReservationLine(
        tx: Prisma.TransactionClient,
        args: {
            reservationLineId: string
            actualQty: DecimalLike
            v15Qty?: DecimalLike | null
            idempotencyKey: string
            occurredAt: Date
            actorId?: string | null
            reason?: string | null
        },
    ) {
        const existing = await tx.inventoryReservationEvent.findUnique({
            where: { idempotencyKey: args.idempotencyKey },
        })
        if (existing) return existing

        const line = await tx.inventoryReservationLine.findUniqueOrThrow({
            where: { id: args.reservationLineId },
        })
        const actualQty = this.decimal(args.actualQty)
        if (!actualQty.isPositive() || actualQty.greaterThan(line.activeActualQty)) {
            throw new ConflictException({ code: 'RESERVATION_CONSUME_EXCEEDS_ACTIVE_QTY' })
        }

        await this.lockKeys(tx, [
            `availability:${this.availabilityKey(line.warehouseId, line.productId, line.ownerPartyId)}`,
        ])
        const balance = await tx.inventoryAvailabilityBalance.findUniqueOrThrow({
            where: {
                warehouseId_productId_ownerPartyId: {
                    warehouseId: line.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                },
            },
        })

        const v15Qty = args.v15Qty == null ? null : this.decimal(args.v15Qty)
        if (this.decimal(line.activeV15Qty).isPositive() && !v15Qty?.isPositive()) {
            throw new BadRequestException({ code: 'RESERVATION_CONSUME_V15_QTY_REQUIRED' })
        }
        if (v15Qty?.greaterThan(this.decimal(line.activeV15Qty))) {
            throw new ConflictException({ code: 'RESERVATION_CONSUME_EXCEEDS_ACTIVE_V15_QTY' })
        }
        const activeActualQty = this.decimal(line.activeActualQty).minus(actualQty)
        const consumedActualQty = this.decimal(line.consumedActualQty).plus(actualQty)
        const activeV15Qty =
            line.activeV15Qty == null ? null : this.decimal(line.activeV15Qty).minus(this.decimal(v15Qty))
        const consumedV15Qty =
            line.consumedV15Qty == null && v15Qty == null
                ? null
                : this.decimal(line.consumedV15Qty).plus(this.decimal(v15Qty))
        const reservedActualQty = this.decimal(balance.reservedActualQty).minus(actualQty)
        const reservedV15Qty =
            balance.reservedV15Qty == null
                ? null
                : this.decimal(balance.reservedV15Qty).minus(this.decimal(v15Qty))
        this.assertAvailabilityInvariant({ ...balance, reservedActualQty, reservedV15Qty })

        const event = await tx.inventoryReservationEvent.create({
            data: {
                reservationLineId: line.id,
                type: ReservationEventType.CONSUME,
                actualQty,
                v15Qty,
                idempotencyKey: args.idempotencyKey,
                occurredAt: args.occurredAt,
                actorId: args.actorId ?? null,
                reason: args.reason ?? null,
            },
        })
        await tx.inventoryReservationLine.update({
            where: { id: line.id },
            data: { activeActualQty, activeV15Qty, consumedActualQty, consumedV15Qty, version: { increment: 1 } },
        })
        await tx.inventoryAvailabilityBalance.update({
            where: { id: balance.id },
            data: { reservedActualQty, reservedV15Qty, version: { increment: 1 } },
        })
        return event
    }

    async changeRestriction(
        tx: Prisma.TransactionClient,
        args: {
            kind: RestrictionKind
            restrictionId: string
            type: RestrictionEventType
            actualQty: DecimalLike
            v15Qty?: DecimalLike | null
            idempotencyKey: string
            occurredAt: Date
            actorId?: string | null
            reason?: string | null
        },
    ) {
        const delegate =
            args.kind === 'PENDING_RELEASE' ? tx.inventoryPendingReleaseEvent : tx.inventoryBlockEvent
        const existing = await (delegate as typeof tx.inventoryPendingReleaseEvent).findUnique({
            where: { idempotencyKey: args.idempotencyKey },
        })
        if (existing) return existing

        const restriction =
            args.kind === 'PENDING_RELEASE'
                ? await tx.inventoryPendingRelease.findUniqueOrThrow({ where: { id: args.restrictionId } })
                : await tx.inventoryBlock.findUniqueOrThrow({ where: { id: args.restrictionId } })
        const actualQty = this.decimal(args.actualQty)
        if (!actualQty.isPositive()) throw new BadRequestException({ code: 'RESTRICTION_QTY_MUST_BE_POSITIVE' })

        await this.lockKeys(tx, [
            `availability:${this.availabilityKey(
                restriction.warehouseId,
                restriction.productId,
                restriction.ownerPartyId,
            )}`,
        ])
        const balance = await tx.inventoryAvailabilityBalance.findUniqueOrThrow({
            where: {
                warehouseId_productId_ownerPartyId: {
                    warehouseId: restriction.warehouseId,
                    productId: restriction.productId,
                    ownerPartyId: restriction.ownerPartyId,
                },
            },
        })

        const isActivation = args.type === RestrictionEventType.ACTIVATE
        if (!isActivation && actualQty.greaterThan(restriction.activeActualQty)) {
            throw new ConflictException({ code: 'RESTRICTION_RELEASE_EXCEEDS_ACTIVE_QTY' })
        }
        const signedQty = isActivation ? actualQty : actualQty.negated()
        const bucket = args.kind === 'PENDING_RELEASE' ? 'pendingActualQty' : 'blockedActualQty'
        const nextBucket = this.decimal(balance[bucket]).plus(signedQty)
        const v15Qty = args.v15Qty == null ? null : this.decimal(args.v15Qty)
        if (!isActivation && v15Qty?.greaterThan(this.decimal(restriction.activeV15Qty))) {
            throw new ConflictException({ code: 'RESTRICTION_RELEASE_EXCEEDS_ACTIVE_V15_QTY' })
        }
        const v15Bucket = args.kind === 'PENDING_RELEASE' ? 'pendingV15Qty' : 'blockedV15Qty'
        const nextV15Bucket =
            balance[v15Bucket] == null && v15Qty == null
                ? null
                : this.decimal(balance[v15Bucket]).plus(isActivation ? this.decimal(v15Qty) : this.decimal(v15Qty).negated())
        this.assertAvailabilityInvariant({ ...balance, [bucket]: nextBucket, [v15Bucket]: nextV15Bucket })

        const eventData = {
            type: args.type,
            actualQty,
            v15Qty,
            idempotencyKey: args.idempotencyKey,
            occurredAt: args.occurredAt,
            actorId: args.actorId ?? null,
            reason: args.reason ?? null,
        }
        const event =
            args.kind === 'PENDING_RELEASE'
                ? await tx.inventoryPendingReleaseEvent.create({
                      data: { ...eventData, pendingReleaseId: args.restrictionId },
                  })
                : await tx.inventoryBlockEvent.create({
                      data: { ...eventData, blockId: args.restrictionId },
                  })

        const activeActualQty = this.decimal(restriction.activeActualQty).plus(signedQty)
        const activeV15Qty =
            restriction.activeV15Qty == null && v15Qty == null
                ? null
                : this.decimal(restriction.activeV15Qty).plus(
                      isActivation ? this.decimal(v15Qty) : this.decimal(v15Qty).negated(),
                  )
        const status = activeActualQty.isZero()
            ? args.type === RestrictionEventType.CANCEL
                ? RestrictionStatus.CANCELLED
                : RestrictionStatus.RELEASED
            : isActivation
              ? RestrictionStatus.ACTIVE
              : RestrictionStatus.PARTIALLY_RELEASED
        if (args.kind === 'PENDING_RELEASE') {
            await tx.inventoryPendingRelease.update({
                where: { id: args.restrictionId },
                data: { activeActualQty, activeV15Qty, status, version: { increment: 1 } },
            })
        } else {
            await tx.inventoryBlock.update({
                where: { id: args.restrictionId },
                data: { activeActualQty, activeV15Qty, status, version: { increment: 1 } },
            })
        }
        await tx.inventoryAvailabilityBalance.update({
            where: { id: balance.id },
            data: { [bucket]: nextBucket, [v15Bucket]: nextV15Bucket, version: { increment: 1 } },
        })
        return event
    }
}
