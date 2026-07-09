import { BadRequestException, Injectable } from '@nestjs/common'
import {
    AvailabilityLedgerSourceType,
    Prisma,
    WarehouseOwnerType,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

type DecimalLike = Prisma.Decimal | string | number

export type AvailabilityDelta = {
    availableQty?: DecimalLike
    reservedQty?: DecimalLike
    inTransitQty?: DecimalLike
    expectedQty?: DecimalLike
}

@Injectable()
export class WarehouseAvailabilityService {
    constructor(private readonly prisma: PrismaService) {}

    ownerKey(ownerType: WarehouseOwnerType, ownerCustomerId?: string | null) {
        if (ownerType === WarehouseOwnerType.INTERNAL) {
            if (ownerCustomerId) {
                throw new BadRequestException('INTERNAL ownership must not have ownerCustomerId')
            }
            return 'INTERNAL'
        }
        if (!ownerCustomerId) {
            throw new BadRequestException(`${ownerType} ownership requires ownerCustomerId`)
        }
        return `${ownerType}:${ownerCustomerId}`
    }

    async applyDelta(args: {
        tx: Prisma.TransactionClient
        supplierLocationId: string
        productId: string
        ownerType: WarehouseOwnerType
        ownerCustomerId?: string | null
        delta: AvailabilityDelta
        sourceType: AvailabilityLedgerSourceType
        sourceId: string
        sourceAction: string
        occurredAt?: Date
        note?: string | null
    }) {
        const {
            tx,
            supplierLocationId,
            productId,
            ownerType,
            ownerCustomerId,
            sourceType,
            sourceId,
            sourceAction,
        } = args
        const ownerKey = this.ownerKey(ownerType, ownerCustomerId)

        const alreadyApplied = await tx.warehouseAvailabilityLedger.findUnique({
            where: {
                sourceType_sourceId_sourceAction_supplierLocationId_productId_ownerKey: {
                    sourceType,
                    sourceId,
                    sourceAction,
                    supplierLocationId,
                    productId,
                    ownerKey,
                },
            },
        })
        if (alreadyApplied) return alreadyApplied

        await tx.$queryRaw`
            SELECT pg_advisory_xact_lock(
                hashtext(${`${supplierLocationId}:${productId}:${ownerKey}`})
            )
        `

        const balance = await tx.warehouseAvailabilityBalance.upsert({
            where: {
                supplierLocationId_productId_ownerKey: {
                    supplierLocationId,
                    productId,
                    ownerKey,
                },
            },
            create: {
                supplierLocationId,
                productId,
                ownerType,
                ownerKey,
                ownerCustomerId: ownerCustomerId ?? null,
            },
            update: {},
        })

        const dAvailable = new Prisma.Decimal(args.delta.availableQty ?? 0)
        const dReserved = new Prisma.Decimal(args.delta.reservedQty ?? 0)
        const dTransit = new Prisma.Decimal(args.delta.inTransitQty ?? 0)
        const dExpected = new Prisma.Decimal(args.delta.expectedQty ?? 0)

        const afterAvailable = new Prisma.Decimal(balance.availableQty).plus(dAvailable)
        const afterReserved = new Prisma.Decimal(balance.reservedQty).plus(dReserved)
        const afterTransit = new Prisma.Decimal(balance.inTransitQty).plus(dTransit)
        const afterExpected = new Prisma.Decimal(balance.expectedQty).plus(dExpected)
        const sellable = afterAvailable.minus(afterReserved)

        if (
            afterAvailable.isNegative() ||
            afterReserved.isNegative() ||
            afterTransit.isNegative() ||
            afterExpected.isNegative() ||
            sellable.isNegative()
        ) {
            throw new BadRequestException({
                code: 'INSUFFICIENT_AVAILABLE_INVENTORY',
                supplierLocationId,
                productId,
                ownerKey,
                afterAvailable: afterAvailable.toString(),
                afterReserved: afterReserved.toString(),
                afterInTransit: afterTransit.toString(),
                afterExpected: afterExpected.toString(),
                sellable: sellable.toString(),
            })
        }

        await tx.warehouseAvailabilityBalance.update({
            where: { id: balance.id },
            data: {
                availableQty: afterAvailable,
                reservedQty: afterReserved,
                inTransitQty: afterTransit,
                expectedQty: afterExpected,
            },
        })

        return tx.warehouseAvailabilityLedger.create({
            data: {
                supplierLocationId,
                productId,
                ownerType,
                ownerKey,
                ownerCustomerId: ownerCustomerId ?? null,
                deltaAvailableQty: dAvailable,
                deltaReservedQty: dReserved,
                deltaInTransitQty: dTransit,
                deltaExpectedQty: dExpected,
                afterAvailableQty: afterAvailable,
                afterReservedQty: afterReserved,
                afterInTransitQty: afterTransit,
                afterExpectedQty: afterExpected,
                sourceType,
                sourceId,
                sourceAction,
                occurredAt: args.occurredAt ?? new Date(),
                note: args.note ?? null,
            },
        })
    }

    async receiveGoods(args: {
        tx: Prisma.TransactionClient
        goodsReceiptId: string
        supplierLocationId: string
        productId: string
        qty: DecimalLike
        ownerType?: WarehouseOwnerType
        ownerCustomerId?: string | null
        occurredAt?: Date
    }) {
        const ledger = await this.applyDelta({
            ...args,
            ownerType: args.ownerType ?? WarehouseOwnerType.INTERNAL,
            delta: { availableQty: args.qty },
            sourceType: AvailabilityLedgerSourceType.GOODS_RECEIPT,
            sourceId: args.goodsReceiptId,
            sourceAction: 'CONFIRM',
        })

        const existingAllocations = await args.tx.expectedInventoryReceiptAllocation.count({
            where: { goodsReceiptId: args.goodsReceiptId },
        })
        if (existingAllocations) return ledger

        const receipt = await args.tx.goodsReceipt.findUnique({
            where: { id: args.goodsReceiptId },
            select: { purchaseOrderId: true },
        })
        if (!receipt?.purchaseOrderId) return ledger

        const charterOrders = await args.tx.shipCharterOrder.findMany({
            where: { purchaseOrderId: receipt.purchaseOrderId },
            select: { id: true },
        })
        const sourceIds = [receipt.purchaseOrderId, ...charterOrders.map((x) => x.id)]
        const expectations = await args.tx.expectedInventory.findMany({
            where: {
                sourceId: { in: sourceIds },
                supplierLocationId: args.supplierLocationId,
                productId: args.productId,
                status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] },
            },
            orderBy: [{ expectedDate: 'asc' }, { createdAt: 'asc' }],
        })

        let remainingReceiptQty = new Prisma.Decimal(args.qty)
        for (const expected of expectations) {
            if (remainingReceiptQty.lessThanOrEqualTo(0)) break
            const expectedRemainder = new Prisma.Decimal(expected.expectedQty).minus(expected.receivedQty)
            const allocatedQty = Prisma.Decimal.min(remainingReceiptQty, expectedRemainder)
            if (allocatedQty.lessThanOrEqualTo(0)) continue

            await args.tx.expectedInventoryReceiptAllocation.create({
                data: {
                    expectedInventoryId: expected.id,
                    goodsReceiptId: args.goodsReceiptId,
                    allocatedQty,
                },
            })
            const receivedQty = new Prisma.Decimal(expected.receivedQty).plus(allocatedQty)
            await args.tx.expectedInventory.update({
                where: { id: expected.id },
                data: {
                    receivedQty,
                    status: receivedQty.equals(expected.expectedQty) ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
                },
            })
            await this.applyDelta({
                tx: args.tx,
                supplierLocationId: expected.supplierLocationId,
                productId: expected.productId,
                ownerType: expected.ownerType,
                ownerCustomerId: expected.ownerCustomerId,
                delta: { expectedQty: allocatedQty.negated() },
                sourceType: AvailabilityLedgerSourceType.EXPECTED_INVENTORY,
                sourceId: expected.id,
                sourceAction: `RECEIPT:${args.goodsReceiptId}`,
                occurredAt: args.occurredAt,
            })
            remainingReceiptQty = remainingReceiptQty.minus(allocatedQty)
        }
        return ledger
    }

    async voidGoods(args: {
        tx: Prisma.TransactionClient
        goodsReceiptId: string
        supplierLocationId: string
        productId: string
        qty: DecimalLike
        occurredAt?: Date
        note?: string | null
    }) {
        const ledger = await this.applyDelta({
            tx: args.tx,
            supplierLocationId: args.supplierLocationId,
            productId: args.productId,
            ownerType: WarehouseOwnerType.INTERNAL,
            delta: { availableQty: new Prisma.Decimal(args.qty).negated() },
            sourceType: AvailabilityLedgerSourceType.GOODS_RECEIPT,
            sourceId: args.goodsReceiptId,
            sourceAction: 'VOID',
            occurredAt: args.occurredAt,
            note: args.note,
        })

        const allocations = await args.tx.expectedInventoryReceiptAllocation.findMany({
            where: { goodsReceiptId: args.goodsReceiptId },
            include: { expectedInventory: true },
        })
        for (const allocation of allocations) {
            const expected = allocation.expectedInventory
            const receivedQty = new Prisma.Decimal(expected.receivedQty).minus(allocation.allocatedQty)
            await args.tx.expectedInventory.update({
                where: { id: expected.id },
                data: {
                    receivedQty,
                    status: receivedQty.isZero() ? 'OPEN' : 'PARTIALLY_RECEIVED',
                },
            })
            await this.applyDelta({
                tx: args.tx,
                supplierLocationId: expected.supplierLocationId,
                productId: expected.productId,
                ownerType: expected.ownerType,
                ownerCustomerId: expected.ownerCustomerId,
                delta: { expectedQty: allocation.allocatedQty },
                sourceType: AvailabilityLedgerSourceType.EXPECTED_INVENTORY,
                sourceId: expected.id,
                sourceAction: `VOID-RECEIPT:${args.goodsReceiptId}`,
                occurredAt: args.occurredAt,
            })
        }
        await args.tx.expectedInventoryReceiptAllocation.deleteMany({
            where: { goodsReceiptId: args.goodsReceiptId },
        })
        return ledger
    }
}
