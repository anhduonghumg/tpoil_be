import { BadRequestException, Injectable } from '@nestjs/common'
import { CostLayerEntryType, CostLayerStatus, Prisma, SalesDeliveryStatus } from '@prisma/client'

import { ConsumeTermCostLayerDto } from './dto/consume-term-cost-layer.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

/** One issued lot for one delivery line — the caller has already decided WHICH lot. */
export type ExactLotConsumption = {
    salesDeliveryLineId: string
    inventoryLotId: string
    ownerPartyId: string
    actualQty: Prisma.Decimal | number | string
}

export type ExactLotConsumptionResult = {
    salesDeliveryLineId: string
    inventoryLotId: string
    costLayerId: string
    consumeQty: string
    unitCost: string
    consumeCost: string
    isProvisional: boolean
}

@Injectable()
export class PurchaseTermCostLayerService {
    constructor(private readonly prisma: PrismaService) {}

    private toApiLayer(layer: any, warehouseId?: string) {
        const stock = warehouseId
            ? layer.lot.stockBalances.find((row: any) => row.warehouseId === warehouseId)
            : layer.lot.stockBalances[0]
        const unitCostPerLiter = layer.remainingActualQty.isZero()
            ? new Prisma.Decimal(0)
            : layer.remainingValue.div(layer.remainingActualQty)
        const pricingEntry = layer.entries?.find((entry: any) => entry.pricingStageLine?.stage?.run)
        return {
            ...layer,
            supplierCustomerId: layer.ownerPartyId,
            supplierLocationId: stock?.warehouseId ?? null,
            supplierLocation: stock?.warehouse ?? null,
            productId: layer.lot.productId,
            product: layer.lot.product,
            sourceType: pricingEntry ? 'TERM_PRICING_FINAL' : 'COST_LEDGER',
            sourceId: pricingEntry?.pricingStageLine?.stage?.runId ?? layer.inventoryLotId,
            originalQty: layer.originalActualQty,
            remainingQty: layer.remainingActualQty,
            unitCostPerLiter,
            totalCost: layer.remainingValue,
            costDate: layer.openedAt,
        }
    }

    private async layers(warehouseId?: string, productId?: string) {
        return this.prisma.inventoryCostLayer.findMany({
            where: {
                status: CostLayerStatus.OPEN,
                remainingActualQty: { gt: 0 },
                lot: {
                    ...(productId ? { productId } : {}),
                    ...(warehouseId
                        ? {
                              stockBalances: {
                                  some: { warehouseId, actualQty: { gt: 0 } },
                              },
                          }
                        : {}),
                },
            },
            include: {
                owner: true,
                lot: {
                    include: {
                        product: true,
                        stockBalances: {
                            where: warehouseId ? { warehouseId, actualQty: { gt: 0 } } : { actualQty: { gt: 0 } },
                            include: { warehouse: true },
                        },
                    },
                },
                entries: {
                    include: { pricingStageLine: { include: { stage: { include: { run: true } } } } },
                    orderBy: { effectiveAt: 'asc' },
                },
            },
            orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
        })
    }

    async previewConsume(dto: ConsumeTermCostLayerDto) {
        const deliveryLineIds = dto.items.map((item) => item.salesDeliveryLineId)
        if (new Set(deliveryLineIds).size !== deliveryLineIds.length) {
            throw new BadRequestException('COST_DELIVERY_LINE_DUPLICATED')
        }
        const deliveryLines = await this.prisma.salesDeliveryLine.findMany({
            where: { id: { in: deliveryLineIds } },
            include: { delivery: true, orderLine: { select: { productId: true } } },
        })
        const deliveryLineById = new Map(deliveryLines.map((line) => [line.id, line]))
        const results: any[] = []
        for (const item of dto.items) {
            const qtyNeeded = new Prisma.Decimal(item.qty)
            if (!qtyNeeded.isPositive()) throw new BadRequestException('TERM_COST_CONSUME_QTY_INVALID')
            const deliveryLine = deliveryLineById.get(item.salesDeliveryLineId)
            if (!deliveryLine) throw new BadRequestException('COST_DELIVERY_LINE_NOT_FOUND')
            if (deliveryLine.orderLine.productId !== item.productId) {
                throw new BadRequestException('COST_DELIVERY_LINE_PRODUCT_MISMATCH')
            }
            if (deliveryLine.delivery.warehouseId !== item.supplierLocationId) {
                throw new BadRequestException('COST_DELIVERY_LINE_WAREHOUSE_MISMATCH')
            }
            // actualQty stays null until the warehouse confirms the issue.
            if (deliveryLine.actualQty == null) {
                throw new BadRequestException({
                    code: 'COST_DELIVERY_LINE_NOT_CONFIRMED',
                    message: 'Dòng lần giao chưa được kho xác nhận số thực xuất.',
                })
            }
            if (!qtyNeeded.equals(deliveryLine.actualQty)) {
                throw new BadRequestException('COST_DELIVERY_LINE_QUANTITY_MISMATCH')
            }
            const layers = await this.layers(item.supplierLocationId, item.productId)
            let remaining = qtyNeeded
            const consumptions: any[] = []
            let totalCost = new Prisma.Decimal(0)

            for (const layer of layers) {
                if (!remaining.isPositive()) break
                const stockQty = layer.lot.stockBalances.reduce(
                    (sum, stock) => sum.plus(stock.actualQty),
                    new Prisma.Decimal(0),
                )
                const usableQty = Prisma.Decimal.min(layer.remainingActualQty, stockQty)
                if (!usableQty.isPositive()) continue
                const consumeQty = Prisma.Decimal.min(remaining, usableQty)
                const unitCost = layer.remainingActualQty.isZero()
                    ? new Prisma.Decimal(0)
                    : layer.remainingValue.div(layer.remainingActualQty)
                const consumeCost = consumeQty.mul(unitCost)
                const apiLayer = this.toApiLayer(layer, item.supplierLocationId)
                consumptions.push({
                    layerId: layer.id,
                    inventoryLotId: layer.inventoryLotId,
                    sourceType: apiLayer.sourceType,
                    sourceId: apiLayer.sourceId,
                    costDate: layer.openedAt,
                    consumeQty,
                    unitCostPerLiter: unitCost,
                    consumeCost,
                })
                totalCost = totalCost.plus(consumeCost)
                remaining = remaining.minus(consumeQty)
            }
            if (remaining.isPositive()) throw new BadRequestException('TERM_COST_LAYER_NOT_ENOUGH_QTY')
            results.push({
                salesDeliveryLineId: item.salesDeliveryLineId,
                productId: item.productId,
                supplierLocationId: item.supplierLocationId,
                requestedQty: qtyNeeded,
                totalCost,
                avgUnitCost: totalCost.div(qtyNeeded),
                consumptions,
            })
        }
        return {
            consumeDate: dto.consumeDate,
            items: results,
            grandTotalCost: results.reduce(
                (sum, item) => sum.plus(item.totalCost),
                new Prisma.Decimal(0),
            ),
        }
    }

    async commitConsume(dto: ConsumeTermCostLayerDto) {
        const preview = await this.previewConsume(dto)
        await this.prisma.$transaction(async (tx) => {
            const deliveryLineIds = preview.items.map((item) => item.salesDeliveryLineId as string).sort()
            for (const deliveryLineId of deliveryLineIds) {
                await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'cost-delivery-line:' + deliveryLineId}))`
            }
            const deliveryLines = await tx.salesDeliveryLine.findMany({
                where: { id: { in: deliveryLineIds } },
                select: { id: true, delivery: { select: { status: true } } },
            })
            if (
                deliveryLines.length !== deliveryLineIds.length ||
                deliveryLines.some((line) => line.delivery.status !== SalesDeliveryStatus.POSTED)
            ) {
                throw new BadRequestException('COST_DELIVERY_MUST_BE_POSTED')
            }
            const existingIssues = await tx.costLayerEntry.count({
                where: {
                    salesDeliveryLineId: { in: deliveryLineIds },
                    type: CostLayerEntryType.SALES_ISSUE,
                },
            })
            if (existingIssues) throw new BadRequestException('COST_DELIVERY_LINE_ALREADY_CONSUMED')

            const layerIds = preview.items
                .flatMap((item) => item.consumptions.map((row: any) => row.layerId as string))
                .sort()
            for (const layerId of [...new Set(layerIds)]) {
                await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'cost-layer:' + layerId}))`
            }
            for (const item of preview.items) {
                for (const row of item.consumptions) {
                    const layer = await tx.inventoryCostLayer.findUniqueOrThrow({ where: { id: row.layerId } })
                    const qty = new Prisma.Decimal(row.consumeQty)
                    const value = new Prisma.Decimal(row.consumeCost)
                    if (qty.greaterThan(layer.remainingActualQty) || value.greaterThan(layer.remainingValue)) {
                        throw new BadRequestException('TERM_COST_LAYER_CONCURRENT_QTY_CHANGED')
                    }
                    const idempotencyKey = `cost-sales-issue:${item.salesDeliveryLineId}:${layer.id}`
                    const existing = await tx.costLayerEntry.findUnique({ where: { idempotencyKey } })
                    if (existing) continue
                    await tx.costLayerEntry.create({
                        data: {
                            costLayerId: layer.id,
                            type: CostLayerEntryType.SALES_ISSUE,
                            actualQtyDelta: qty.negated(),
                            valueDelta: value.negated(),
                            salesDeliveryLineId: item.salesDeliveryLineId,
                            idempotencyKey,
                            effectiveAt: new Date(dto.consumeDate),
                        },
                    })
                    const remainingActualQty = layer.remainingActualQty.minus(qty)
                    const remainingValue = layer.remainingValue.minus(value)
                    await tx.inventoryCostLayer.update({
                        where: { id: layer.id },
                        data: {
                            remainingActualQty,
                            remainingValue,
                            status: remainingActualQty.isZero() ? CostLayerStatus.CLOSED : CostLayerStatus.OPEN,
                            version: { increment: 1 },
                        },
                    })
                }
            }
        })
        return preview
    }

    async listOpenLayers(params?: { supplierLocationId?: string; productId?: string }) {
        const layers = await this.layers(params?.supplierLocationId, params?.productId)
        return layers.map((layer) => this.toApiLayer(layer, params?.supplierLocationId))
    }

    /*
     * =========================================================
     * Transaction-aware core, used by the sales issue flow.
     *
     * Sales decides the lots (SalesDeliveryLotAllocation) so stock and cost can never
     * disagree; these methods must NOT run their own FIFO (spec v1.2 §8.3).
     * =========================================================
     */

    /**
     * A lot with no cost layer yet (goods received before pricing was finalised) gets a
     * provisional zero-value layer so the sale still leaves a revaluable cost trail —
     * finalising the TERM price later can correct it (GĐ 8).
     */
    private async ensureCostLayer(
        tx: Prisma.TransactionClient,
        inventoryLotId: string,
        ownerPartyId: string,
    ) {
        const existing = await tx.inventoryCostLayer.findUnique({
            where: { inventoryLotId_ownerPartyId: { inventoryLotId, ownerPartyId } },
        })
        if (existing) return existing

        const lot = await tx.inventoryLot.findUniqueOrThrow({
            where: { id: inventoryLotId },
            select: { receivedActualQty: true, receivedAt: true },
        })
        const layer = await tx.inventoryCostLayer.create({
            data: {
                inventoryLotId,
                ownerPartyId,
                originalActualQty: lot.receivedActualQty,
                remainingActualQty: lot.receivedActualQty,
                remainingValue: 0,
                currency: 'VND',
                isProvisional: true,
                openedAt: lot.receivedAt,
            },
        })
        await tx.costLayerEntry.create({
            data: {
                costLayerId: layer.id,
                type: CostLayerEntryType.OPEN_PROVISIONAL,
                actualQtyDelta: lot.receivedActualQty,
                valueDelta: 0,
                idempotencyKey: `cost-provisional-open:${layer.id}`,
                effectiveAt: lot.receivedAt,
            },
        })
        return layer
    }

    /**
     * Estimates what a quantity would cost if issued today, walking the open layers oldest
     * first. Used before any delivery exists — at order submit, to judge the expected margin —
     * so it must not write anything and must not assume which lots will actually be picked.
     *
     * Returns null when the layers cannot cover the quantity: an estimate from thin air would
     * be worse than admitting we do not know.
     */
    async estimateFifoCostInTx(
        tx: Prisma.TransactionClient | PrismaService,
        args: { warehouseId: string; productId: string; ownerPartyId: string; qty: Prisma.Decimal },
    ): Promise<{ cost: Prisma.Decimal; isProvisional: boolean } | null> {
        if (!args.qty.greaterThan(0)) return null
        const layers = await tx.inventoryCostLayer.findMany({
            where: {
                ownerPartyId: args.ownerPartyId,
                status: CostLayerStatus.OPEN,
                remainingActualQty: { gt: 0 },
                lot: {
                    productId: args.productId,
                    stockBalances: { some: { warehouseId: args.warehouseId, actualQty: { gt: 0 } } },
                },
            },
            orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
        })

        let remaining = args.qty
        let cost = new Prisma.Decimal(0)
        let isProvisional = false
        for (const layer of layers) {
            if (!remaining.greaterThan(0)) break
            const take = Prisma.Decimal.min(remaining, layer.remainingActualQty)
            if (!take.greaterThan(0)) continue
            const unitCost = layer.remainingActualQty.isZero()
                ? new Prisma.Decimal(0)
                : layer.remainingValue.div(layer.remainingActualQty)
            cost = cost.plus(take.mul(unitCost))
            if (layer.isProvisional) isProvisional = true
            remaining = remaining.minus(take)
        }
        if (remaining.greaterThan(0)) return null
        return { cost, isProvisional }
    }

    /** Values the given lots without writing anything. */
    async previewConsumeInTx(
        tx: Prisma.TransactionClient,
        allocations: ExactLotConsumption[],
    ): Promise<ExactLotConsumptionResult[]> {
        const results: ExactLotConsumptionResult[] = []
        for (const allocation of allocations) {
            const qty = new Prisma.Decimal(allocation.actualQty)
            if (!qty.greaterThan(0)) {
                throw new BadRequestException({
                    code: 'COST_ALLOCATION_QTY_INVALID',
                    message: 'Số lượng phân bổ giá vốn phải lớn hơn 0.',
                })
            }
            const layer = await this.ensureCostLayer(tx, allocation.inventoryLotId, allocation.ownerPartyId)
            if (qty.greaterThan(layer.remainingActualQty)) {
                throw new BadRequestException({
                    code: 'COST_LAYER_INSUFFICIENT_QTY',
                    message: 'Lớp giá vốn của lô không còn đủ số lượng.',
                    inventoryLotId: allocation.inventoryLotId,
                    remainingQty: layer.remainingActualQty.toString(),
                    requestedQty: qty.toString(),
                })
            }
            const unitCost = layer.remainingActualQty.isZero()
                ? new Prisma.Decimal(0)
                : layer.remainingValue.div(layer.remainingActualQty)
            const consumeCost = qty.mul(unitCost)
            results.push({
                salesDeliveryLineId: allocation.salesDeliveryLineId,
                inventoryLotId: allocation.inventoryLotId,
                costLayerId: layer.id,
                consumeQty: qty.toString(),
                unitCost: unitCost.toString(),
                consumeCost: consumeCost.toString(),
                isProvisional: layer.isProvisional,
            })
        }
        return results
    }

    /** Writes the SALES_ISSUE cost entries for lots the caller already picked. */
    async commitConsumeInTx(
        tx: Prisma.TransactionClient,
        allocations: ExactLotConsumption[],
        effectiveAt: Date,
    ) {
        const preview = await this.previewConsumeInTx(tx, allocations)
        for (const row of preview) {
            const idempotencyKey = `cost-sales-issue:${row.salesDeliveryLineId}:${row.costLayerId}`
            const existing = await tx.costLayerEntry.findUnique({ where: { idempotencyKey } })
            if (existing) continue

            const qty = new Prisma.Decimal(row.consumeQty)
            const value = new Prisma.Decimal(row.consumeCost)
            await tx.costLayerEntry.create({
                data: {
                    costLayerId: row.costLayerId,
                    type: CostLayerEntryType.SALES_ISSUE,
                    actualQtyDelta: qty.negated(),
                    valueDelta: value.negated(),
                    salesDeliveryLineId: row.salesDeliveryLineId,
                    idempotencyKey,
                    effectiveAt,
                },
            })
            const layer = await tx.inventoryCostLayer.findUniqueOrThrow({ where: { id: row.costLayerId } })
            const remainingActualQty = layer.remainingActualQty.minus(qty)
            await tx.inventoryCostLayer.update({
                where: { id: row.costLayerId },
                data: {
                    remainingActualQty,
                    remainingValue: layer.remainingValue.minus(value),
                    status: remainingActualQty.isZero() ? CostLayerStatus.CLOSED : CostLayerStatus.OPEN,
                    version: { increment: 1 },
                },
            })
        }
        return preview
    }

    /** Append-only reversal of a delivery line's cost consumption (correction, spec §9). */
    async reverseConsumeInTx(
        tx: Prisma.TransactionClient,
        salesDeliveryLineIds: string[],
        effectiveAt: Date,
    ) {
        if (!salesDeliveryLineIds.length) return 0
        const entries = await tx.costLayerEntry.findMany({
            where: {
                salesDeliveryLineId: { in: salesDeliveryLineIds },
                type: CostLayerEntryType.SALES_ISSUE,
                reversedBy: null,
            },
        })
        for (const entry of entries) {
            const idempotencyKey = `cost-sales-issue-reverse:${entry.id}`
            const existing = await tx.costLayerEntry.findUnique({ where: { idempotencyKey } })
            if (existing) continue

            await tx.costLayerEntry.create({
                data: {
                    costLayerId: entry.costLayerId,
                    type: CostLayerEntryType.REVERSAL,
                    actualQtyDelta: entry.actualQtyDelta.negated(),
                    valueDelta: entry.valueDelta.negated(),
                    // A DB check allows exactly one source link per entry: a reversal cites the
                    // entry it undoes, and reaches the delivery line through it.
                    reversalOfId: entry.id,
                    idempotencyKey,
                    effectiveAt,
                },
            })
            const layer = await tx.inventoryCostLayer.findUniqueOrThrow({ where: { id: entry.costLayerId } })
            await tx.inventoryCostLayer.update({
                where: { id: entry.costLayerId },
                data: {
                    remainingActualQty: layer.remainingActualQty.plus(entry.actualQtyDelta.negated()),
                    remainingValue: layer.remainingValue.plus(entry.valueDelta.negated()),
                    status: CostLayerStatus.OPEN,
                    version: { increment: 1 },
                },
            })
        }
        return entries.length
    }
}
