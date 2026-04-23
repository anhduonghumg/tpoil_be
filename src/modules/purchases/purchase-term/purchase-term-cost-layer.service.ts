import { BadRequestException, Injectable } from '@nestjs/common'
import { CostLayerStatus, Prisma } from '@prisma/client'

import { ConsumeTermCostLayerDto } from './dto/consume-term-cost-layer.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class PurchaseTermCostLayerService {
    constructor(private readonly prisma: PrismaService) {}

    async previewConsume(dto: ConsumeTermCostLayerDto) {
        const results = [] as any[]

        for (const item of dto.items) {
            const qtyNeeded = Number(item.qty || 0)
            if (qtyNeeded <= 0) {
                throw new BadRequestException('TERM_COST_CONSUME_QTY_INVALID')
            }

            const layers = await this.prisma.inventoryCostLayer.findMany({
                where: {
                    supplierLocationId: item.supplierLocationId,
                    productId: item.productId,
                    status: CostLayerStatus.OPEN,
                    remainingQty: {
                        gt: new Prisma.Decimal(0),
                    },
                },
                orderBy: [{ costDate: 'asc' }, { createdAt: 'asc' }],
            })

            let remain = qtyNeeded
            const consumptions = [] as any[]
            let totalCost = 0

            for (const layer of layers) {
                if (remain <= 0) break

                const layerRemaining = Number(layer.remainingQty || 0)
                if (layerRemaining <= 0) continue

                const consumeQty = Math.min(remain, layerRemaining)
                const unitCostPerLiter = Number(layer.unitCostPerLiter || 0)
                const consumeCost = consumeQty * unitCostPerLiter

                consumptions.push({
                    layerId: layer.id,
                    sourceType: layer.sourceType,
                    sourceId: layer.sourceId,
                    costDate: layer.costDate,
                    consumeQty,
                    unitCostPerLiter,
                    consumeCost,
                })

                totalCost += consumeCost
                remain -= consumeQty
            }

            if (remain > 0) {
                throw new BadRequestException('TERM_COST_LAYER_NOT_ENOUGH_QTY')
            }

            results.push({
                productId: item.productId,
                supplierLocationId: item.supplierLocationId,
                requestedQty: qtyNeeded,
                totalCost,
                avgUnitCost: qtyNeeded > 0 ? totalCost / qtyNeeded : 0,
                consumptions,
            })
        }

        return {
            consumeDate: dto.consumeDate,
            items: results,
            grandTotalCost: results.reduce((sum, x) => sum + Number(x.totalCost || 0), 0),
        }
    }

    async commitConsume(dto: ConsumeTermCostLayerDto) {
        const preview = await this.previewConsume(dto)

        await this.prisma.$transaction(async (tx) => {
            for (const item of preview.items) {
                for (const row of item.consumptions) {
                    const layer = await tx.inventoryCostLayer.findUnique({
                        where: { id: row.layerId },
                    })

                    if (!layer) {
                        throw new BadRequestException('TERM_COST_LAYER_NOT_FOUND')
                    }

                    const currentRemaining = Number(layer.remainingQty || 0)
                    if (currentRemaining < Number(row.consumeQty || 0)) {
                        throw new BadRequestException('TERM_COST_LAYER_CONCURRENT_QTY_CHANGED')
                    }

                    const nextRemaining = currentRemaining - Number(row.consumeQty || 0)
                    await tx.inventoryCostLayer.update({
                        where: { id: layer.id },
                        data: {
                            remainingQty: nextRemaining,
                            status: nextRemaining <= 0 ? CostLayerStatus.CLOSED : CostLayerStatus.OPEN,
                        },
                    })
                }
            }
        })

        return preview
    }

    async listOpenLayers(params?: { supplierLocationId?: string; productId?: string }) {
        return this.prisma.inventoryCostLayer.findMany({
            where: {
                supplierLocationId: params?.supplierLocationId,
                productId: params?.productId,
                status: CostLayerStatus.OPEN,
            },
            orderBy: [{ costDate: 'asc' }, { createdAt: 'asc' }],
        })
    }
}
