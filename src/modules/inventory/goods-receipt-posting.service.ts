import { BadRequestException, Injectable } from '@nestjs/common'
import {
    ExpectedSupplyStatus,
    InventoryPostingKind,
    Prisma,
    RestrictionEventType,
    SalesOrderSupplySource,
} from '@prisma/client'
import { InventoryCoreService } from './inventory-core.service'

@Injectable()
export class GoodsReceiptPostingService {
    constructor(private readonly inventory: InventoryCoreService) {}

    private async internalOwnerPartyId(tx: Prisma.TransactionClient, warehouseId: string) {
        const warehouse = await tx.warehouse.findUnique({
            where: { id: warehouseId },
            select: { legalEntity: { select: { partyId: true } } },
        })
        if (!warehouse) throw new BadRequestException({ code: 'WAREHOUSE_NOT_FOUND' })
        return warehouse.legalEntity.partyId
    }

    async postSingleLineReceipt(args: {
        tx: Prisma.TransactionClient
        goodsReceiptId: string
        warehouseId: string
        productId: string
        purchaseOrderLineId?: string | null
        actualQty: Prisma.Decimal | number | string
        v15Qty?: Prisma.Decimal | number | string | null
        temperatureC?: Prisma.Decimal | number | string | null
        density?: Prisma.Decimal | number | string | null
        effectiveAt: Date
        actorId?: string | null
        ownerPartyId?: string | null
        supplierPartyId?: string | null
        releaseCode?: SalesOrderSupplySource | null
    }) {
        const ownerPartyId =
            args.ownerPartyId ?? (await this.internalOwnerPartyId(args.tx, args.warehouseId))
        const receipt = await args.tx.goodsReceipt.findUniqueOrThrow({
            where: { id: args.goodsReceiptId },
            select: {
                receiptNo: true,
                purchaseOrder: { select: { supplierCustomerId: true, releaseCode: true } },
            },
        })
        const purchaseSource = args.purchaseOrderLineId
            ? await args.tx.purchaseOrderLine.findUnique({
                  where: { id: args.purchaseOrderLineId },
                  select: {
                      purchaseOrder: { select: { supplierCustomerId: true, releaseCode: true } },
                  },
              })
            : null
        const supplierPartyId =
            args.supplierPartyId ??
            purchaseSource?.purchaseOrder.supplierCustomerId ??
            receipt.purchaseOrder?.supplierCustomerId ??
            null
        const releaseCode =
            args.releaseCode ??
            purchaseSource?.purchaseOrder.releaseCode ??
            receipt.purchaseOrder?.releaseCode ??
            null
        const line = await args.tx.goodsReceiptLine.upsert({
            where: { goodsReceiptId_lineNo: { goodsReceiptId: args.goodsReceiptId, lineNo: 1 } },
            create: {
                goodsReceiptId: args.goodsReceiptId,
                lineNo: 1,
                purchaseOrderLineId: args.purchaseOrderLineId ?? null,
                productId: args.productId,
                ownerPartyId,
                actualQty: args.actualQty,
                v15Qty: args.v15Qty ?? null,
                temperatureC: args.temperatureC ?? null,
                density: args.density ?? null,
            },
            update: {},
        })
        const lot = await args.tx.inventoryLot.upsert({
            where: { receiptLineId: line.id },
            create: {
                lotNo: `${receipt.receiptNo}-${String(line.lineNo).padStart(3, '0')}`,
                receiptLineId: line.id,
                productId: line.productId,
                originOwnerPartyId: line.ownerPartyId,
                supplierPartyId,
                receivedActualQty: line.actualQty,
                receivedV15Qty: line.v15Qty,
                receivedAt: args.effectiveAt,
                releaseCode,
            },
            update: {
                ...(supplierPartyId ? { supplierPartyId } : {}),
                ...(releaseCode ? { releaseCode } : {}),
            },
        })

        const posting = await this.inventory.post(args.tx, {
            postingNo: `GR-${receipt.receiptNo}`,
            kind: InventoryPostingKind.RECEIPT,
            idempotencyKey: `goods-receipt:${args.goodsReceiptId}:post`,
            effectiveAt: args.effectiveAt,
            postedById: args.actorId,
            source: { goodsReceiptId: args.goodsReceiptId },
            lines: [
                {
                    warehouseId: args.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                    inventoryLotId: lot.id,
                    actualQtyDelta: line.actualQty,
                    v15QtyDelta: line.v15Qty,
                },
            ],
        })

        let pending = await args.tx.inventoryPendingRelease.findFirst({
            where: { goodsReceiptLineId: line.id, status: { notIn: ['RELEASED', 'CANCELLED'] } },
        })
        if (!pending) {
            pending = await args.tx.inventoryPendingRelease.create({
                data: {
                    pendingNo: `GR-PENDING-${line.id}`,
                    warehouseId: args.warehouseId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                    inventoryLotId: lot.id,
                    goodsReceiptLineId: line.id,
                    reasonCode: 'AWAITING_SUPPLIER_INVOICE',
                    originalActualQty: line.actualQty,
                    originalV15Qty: line.v15Qty,
                    activeActualQty: 0,
                    activeV15Qty: line.v15Qty == null ? null : 0,
                },
            })
            await this.inventory.changeRestriction(args.tx, {
                kind: 'PENDING_RELEASE',
                restrictionId: pending.id,
                type: RestrictionEventType.ACTIVATE,
                actualQty: line.actualQty,
                v15Qty: line.v15Qty,
                idempotencyKey: `goods-receipt:${args.goodsReceiptId}:pending`,
                occurredAt: args.effectiveAt,
                actorId: args.actorId,
                reason: 'Chờ hóa đơn/chứng từ nhà cung cấp',
            })
        }

        await this.allocateExpectedSupply(args.tx, line.id)
        return { posting, line, lot, pending }
    }

    private async allocateExpectedSupply(tx: Prisma.TransactionClient, receiptLineId: string) {
        const line = await tx.goodsReceiptLine.findUniqueOrThrow({
            where: { id: receiptLineId },
            include: { goodsReceipt: { select: { warehouseId: true } } },
        })
        const existing = await tx.expectedSupplyAllocation.findMany({
            where: { receiptLineId },
            select: { actualQty: true },
        })
        let remaining = new Prisma.Decimal(line.actualQty).minus(
            existing.reduce((sum, item) => sum.plus(item.actualQty), new Prisma.Decimal(0)),
        )
        if (remaining.lessThanOrEqualTo(0)) return

        const supplies = await tx.expectedSupply.findMany({
            where: {
                warehouseId: line.goodsReceipt.warehouseId,
                productId: line.productId,
                ownerPartyId: line.ownerPartyId,
                status: { in: [ExpectedSupplyStatus.OPEN, ExpectedSupplyStatus.PARTIALLY_FULFILLED] },
                ...(line.purchaseOrderLineId ? { purchaseOrderLineId: line.purchaseOrderLineId } : {}),
            },
            orderBy: [{ expectedAt: 'asc' }, { expectedNo: 'asc' }],
        })
        for (const supply of supplies) {
            if (remaining.lessThanOrEqualTo(0)) break
            const openQty = new Prisma.Decimal(supply.expectedActualQty).minus(supply.fulfilledActualQty)
            const allocatedQty = Prisma.Decimal.min(openQty, remaining)
            if (allocatedQty.lessThanOrEqualTo(0)) continue
            await tx.expectedSupplyAllocation.create({
                data: {
                    expectedSupplyId: supply.id,
                    receiptLineId,
                    actualQty: allocatedQty,
                    idempotencyKey: `expected:${supply.id}:receipt-line:${receiptLineId}`,
                },
            })
            const fulfilledActualQty = new Prisma.Decimal(supply.fulfilledActualQty).plus(allocatedQty)
            await tx.expectedSupply.update({
                where: { id: supply.id },
                data: {
                    fulfilledActualQty,
                    status: fulfilledActualQty.equals(supply.expectedActualQty)
                        ? ExpectedSupplyStatus.FULFILLED
                        : ExpectedSupplyStatus.PARTIALLY_FULFILLED,
                    version: { increment: 1 },
                },
            })
            remaining = remaining.minus(allocatedQty)
        }
    }

    async releasePendingForInvoice(
        tx: Prisma.TransactionClient,
        args: { goodsReceiptId: string; occurredAt: Date; actorId?: string | null },
    ) {
        const restrictions = await tx.inventoryPendingRelease.findMany({
            where: {
                receiptLine: { goodsReceiptId: args.goodsReceiptId },
                status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
            },
        })
        for (const restriction of restrictions) {
            await this.inventory.changeRestriction(tx, {
                kind: 'PENDING_RELEASE',
                restrictionId: restriction.id,
                type: RestrictionEventType.RELEASE,
                actualQty: restriction.activeActualQty,
                v15Qty: restriction.activeV15Qty,
                idempotencyKey: `goods-receipt:${args.goodsReceiptId}:invoice-release:${restriction.id}`,
                occurredAt: args.occurredAt,
                actorId: args.actorId,
                reason: 'Đã nhận và post hóa đơn nhà cung cấp',
            })
        }
    }

    async reverseReceipt(
        tx: Prisma.TransactionClient,
        args: { goodsReceiptId: string; effectiveAt: Date; actorId?: string | null },
    ) {
        const original = await tx.inventoryPosting.findUnique({
            where: { goodsReceiptId: args.goodsReceiptId },
            select: { id: true, postingNo: true },
        })
        if (!original) return null

        const restrictions = await tx.inventoryPendingRelease.findMany({
            where: {
                receiptLine: { goodsReceiptId: args.goodsReceiptId },
                status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
            },
        })
        for (const restriction of restrictions) {
            await this.inventory.changeRestriction(tx, {
                kind: 'PENDING_RELEASE',
                restrictionId: restriction.id,
                type: RestrictionEventType.RELEASE,
                actualQty: restriction.activeActualQty,
                v15Qty: restriction.activeV15Qty,
                idempotencyKey: `goods-receipt:${args.goodsReceiptId}:void-release:${restriction.id}`,
                occurredAt: args.effectiveAt,
                actorId: args.actorId,
                reason: 'Đảo phiếu nhập kho',
            })
        }
        return this.inventory.reverse(tx, {
            postingId: original.id,
            postingNo: `${original.postingNo}-REV`,
            idempotencyKey: `goods-receipt:${args.goodsReceiptId}:reverse`,
            effectiveAt: args.effectiveAt,
            postedById: args.actorId,
        })
    }

    async restorePendingForVoidedInvoice(
        tx: Prisma.TransactionClient,
        args: { goodsReceiptId: string; occurredAt: Date; actorId?: string | null },
    ) {
        const restrictions = await tx.inventoryPendingRelease.findMany({
            where: { receiptLine: { goodsReceiptId: args.goodsReceiptId } },
        })
        for (const restriction of restrictions) {
            const missingQty = new Prisma.Decimal(restriction.originalActualQty).minus(restriction.activeActualQty)
            if (missingQty.lessThanOrEqualTo(0)) continue
            await this.inventory.changeRestriction(tx, {
                kind: 'PENDING_RELEASE',
                restrictionId: restriction.id,
                type: RestrictionEventType.ACTIVATE,
                actualQty: missingQty,
                idempotencyKey: `goods-receipt:${args.goodsReceiptId}:invoice-void:${restriction.id}`,
                occurredAt: args.occurredAt,
                actorId: args.actorId,
                reason: 'Hóa đơn nhà cung cấp bị hủy',
            })
        }
    }
}
