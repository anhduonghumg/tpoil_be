import { BadRequestException, Injectable } from '@nestjs/common'
import { CostLayerEntryType, CostLayerStatus, Prisma, SalesDeliveryStatus } from '@prisma/client'

import { ConsumeTermCostLayerDto } from './dto/consume-term-cost-layer.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

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
}
