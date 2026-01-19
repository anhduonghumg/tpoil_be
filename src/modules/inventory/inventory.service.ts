// src/modules/inventory/inventory.service.ts
import { Injectable } from '@nestjs/common'
import { Prisma, InventoryLedgerSourceType } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

type DecimalLike = Prisma.Decimal | number | string

export type InventoryDelta = {
    deltaPhysicalQty?: DecimalLike
    deltaPendingDocQty?: DecimalLike
    deltaPostedQty?: DecimalLike
}

@Injectable()
export class InventoryService {
    constructor(private readonly prisma: PrismaService) {}

    async ensureBalance(tx: Prisma.TransactionClient, supplierLocationId: string, productId: string) {
        return tx.inventoryBalance.upsert({
            where: { supplierLocationId_productId: { supplierLocationId, productId } },
            create: {
                supplierLocationId,
                productId,
                physicalQty: new Prisma.Decimal(0),
                pendingDocQty: new Prisma.Decimal(0),
                postedQty: new Prisma.Decimal(0),
            },
            update: {},
        })
    }

    async applyDeltaAndAppendLedger(args: {
        tx: Prisma.TransactionClient
        supplierLocationId: string
        productId: string
        delta: InventoryDelta
        sourceType: InventoryLedgerSourceType
        sourceId: string
        occurredAt: Date
        note?: string | null
    }) {
        const { tx, supplierLocationId, productId, delta, sourceType, sourceId, occurredAt, note } = args

        const balance = await this.ensureBalance(tx, supplierLocationId, productId)

        const dPhy = new Prisma.Decimal(delta.deltaPhysicalQty ?? 0)
        const dPen = new Prisma.Decimal(delta.deltaPendingDocQty ?? 0)
        const dPos = new Prisma.Decimal(delta.deltaPostedQty ?? 0)

        const afterPhysical = new Prisma.Decimal(balance.physicalQty).plus(dPhy)
        const afterPending = new Prisma.Decimal(balance.pendingDocQty).plus(dPen)
        const afterPosted = new Prisma.Decimal(balance.postedQty).plus(dPos)

        if (afterPending.isNegative()) {
            throw Object.assign(new Error('INVENTORY_NEGATIVE_PENDING'), {
                code: 'INVENTORY_NEGATIVE_PENDING',
            })
        }
        if (afterPosted.isNegative()) {
            throw Object.assign(new Error('INVENTORY_NEGATIVE_POSTED'), {
                code: 'INVENTORY_NEGATIVE_POSTED',
            })
        }

        await tx.inventoryBalance.update({
            where: { id: balance.id },
            data: {
                physicalQty: afterPhysical,
                pendingDocQty: afterPending,
                postedQty: afterPosted,
            },
        })

        await tx.inventoryLedger.create({
            data: {
                supplierLocationId,
                productId,

                deltaPhysicalQty: dPhy,
                deltaPendingDocQty: dPen,
                deltaPostedQty: dPos,

                afterPhysicalQty: afterPhysical,
                afterPendingDocQty: afterPending,
                afterPostedQty: afterPosted,

                sourceType,
                sourceId,
                note: note ?? null,
                occurredAt,
            },
        })

        return { afterPhysical, afterPending, afterPosted }
    }
}
