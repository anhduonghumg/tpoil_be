import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import { CostLayerStatus, FxStage, PricingRunStatus, PricingStageType, Prisma, PurchaseBizType, PurchaseOrderStatus, QtyBasis } from '@prisma/client'

import { PrismaService } from 'src/infra/prisma/prisma.service'

import { CalculateTermPricingDto } from './dto/calculate-term-pricing.dto'

@Injectable()
export class PurchaseTermPricingService {
    constructor(private readonly prisma: PrismaService) {}

    /*
     * =========================
     * Helpers
     * =========================
     */

    private addDays(date: Date, days: number): Date {
        const d = new Date(date)
        d.setUTCDate(d.getUTCDate() + days)
        return d
    }

    private toDateOnly(value?: string | Date | null): Date | undefined {
        if (!value) {
            return undefined
        }

        if (value instanceof Date) {
            return value
        }

        return new Date(`${value}T00:00:00.000Z`)
    }

    private usdPerBblToVndPerLiter(usdPerBbl: number, fxRate: number) {
        /*
         * 1 barrel = 158.987 liters
         */

        return (usdPerBbl * fxRate) / 158.987
    }

    /*
     * =========================
     * Queries
     * =========================
     */

    private async getOrderForPricing(orderId: string) {
        const order = await this.prisma.purchaseOrder.findUnique({
            where: {
                id: orderId,
            },

            include: {
                supplier: true,

                lines: {
                    include: {
                        product: true,
                        supplierLocation: true,
                    },

                    orderBy: {
                        createdAt: 'asc',
                    },
                },

                receipts: {
                    where: {
                        status: 'CONFIRMED',
                    },

                    orderBy: {
                        receiptDate: 'asc',
                    },
                },

                pricingRuns: {
                    include: {
                        stages: {
                            include: {
                                lines: true,
                                costs: true,
                                priceDays: true,
                            },
                        },
                    },

                    orderBy: {
                        createdAt: 'desc',
                    },
                },
            },
        })

        if (!order || order.bizType !== PurchaseBizType.TERM) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        return order
    }

    /*
     * =========================
     * Run
     * =========================
     */

    private async getOrCreateRun(tx: Prisma.TransactionClient, order: any, dto: CalculateTermPricingDto) {
        const existed = await tx.purchasePricingRun.findFirst({
            where: {
                purchaseOrderId: order.id,
            },

            orderBy: {
                createdAt: 'desc',
            },
        })

        if (existed) {
            return existed
        }

        const qtyActualTotal = order.receipts.reduce((sum: number, x: any) => sum + Number(x.qty || 0), 0)

        const qtyV15Total = order.receipts.reduce((sum: number, x: any) => sum + Number(x.standardQtyV15 || 0), 0)

        return tx.purchasePricingRun.create({
            data: {
                purchaseOrderId: order.id,

                supplierCustomerId: order.supplierCustomerId,

                billDate: this.toDateOnly(dto.billDate),

                qtyBasisSelected: dto.qtyBasisSelected ?? QtyBasis.ACTUAL,

                qtyBasisLocked: dto.qtyBasisLocked ?? false,

                qtyActualTotal,

                qtyV15Total,

                status: PricingRunStatus.DRAFT,
            },
        })
    }

    private validateStageFlow(order: any, stageType: PricingStageType) {
        if (order.status === PurchaseOrderStatus.CANCELLED) {
            throw new BadRequestException('PURCHASE_ORDER_CANCELLED')
        }

        if (!order.receipts.length) {
            throw new BadRequestException('CONFIRMED_RECEIPTS_REQUIRED')
        }

        const stages = order.pricingRuns.flatMap((run: any) => run.stages ?? [])

        const hasEstimate = stages.some((x: any) => x.stageType === PricingStageType.ESTIMATE)

        const hasBillNormalize = stages.some((x: any) => x.stageType === PricingStageType.BILL_NORMALIZE)

        if (stageType === PricingStageType.BILL_NORMALIZE && !hasEstimate) {
            throw new BadRequestException('ESTIMATE_REQUIRED')
        }

        if (stageType === PricingStageType.FINAL && !hasBillNormalize) {
            throw new BadRequestException('BILL_NORMALIZE_REQUIRED')
        }
    }

    private async createStageBase(tx: Prisma.TransactionClient, runId: string, order: any, dto: CalculateTermPricingDto, stageType: PricingStageType) {
        const existed = await tx.purchasePricingStage.findFirst({
            where: {
                runId,
                stageType,
            },
        })

        if (existed) {
            throw new BadRequestException(`${stageType}_ALREADY_EXISTS`)
        }

        const mops = Number(dto.mopsAvgUsdPerBbl ?? 0)
        const premium = Number(dto.premiumUsdPerBbl ?? order.termPremiumUsdPerBbl ?? 0)

        return tx.purchasePricingStage.create({
            data: {
                runId,
                stageType,

                mopsAvgUsdPerBbl: new Prisma.Decimal(mops),
                premiumUsdPerBbl: new Prisma.Decimal(premium),
                unitUsdPerBbl: new Prisma.Decimal(mops + premium),

                fxRateDate: this.toDateOnly(dto.fxRateDate),
                fxStage: dto.fxStage ?? FxStage.ESTIMATE,
                fxRate: dto.fxRate !== undefined && dto.fxRate !== null ? new Prisma.Decimal(dto.fxRate) : null,

                envTaxAmountVnd: dto.envTaxAmountVnd !== undefined && dto.envTaxAmountVnd !== null ? new Prisma.Decimal(dto.envTaxAmountVnd) : null,

                vatAmountVnd: dto.vatAmountVnd !== undefined && dto.vatAmountVnd !== null ? new Prisma.Decimal(dto.vatAmountVnd) : null,

                note: dto.note?.trim() || null,
            },
        })
    }

    private async buildStageLines(tx: Prisma.TransactionClient, order: any, stageId: string, dto: CalculateTermPricingDto) {
        for (const input of dto.lines || []) {
            const line = order.lines.find((x: any) => x.id === input.purchaseOrderLineId)

            if (!line) {
                throw new BadRequestException('PURCHASE_ORDER_LINE_NOT_FOUND')
            }

            const qtyActual = input.qtyActual ?? Number(line.withdrawnQty || line.orderedQty || 0)

            const qtyV15 = input.qtyV15 ?? Number(line.withdrawnQty || line.orderedQty || 0)

            await tx.purchasePricingStageLine.create({
                data: {
                    stageId,

                    purchaseOrderLineId: line.id,

                    productId: line.productId,

                    supplierLocationId: line.supplierLocationId,

                    qtyActual: new Prisma.Decimal(qtyActual),

                    qtyV15: new Prisma.Decimal(qtyV15),

                    note: input.note?.trim() || null,
                },
            })
        }
    }

    private async resolvePriceDaysFromPlatts(tx: Prisma.TransactionClient, dto: CalculateTermPricingDto, productIds: string[]) {
        if (dto.priceDays?.length) {
            return dto.priceDays
        }

        if (!dto.plattsBaseDate) {
            return []
        }

        const baseDate = this.toDateOnly(dto.plattsBaseDate)!

        const daysBefore = dto.plattsDaysBefore ?? 5
        const daysAfter = dto.plattsDaysAfter ?? 5

        const fromDate = this.addDays(baseDate, -daysBefore)
        const toDate = this.addDays(baseDate, daysAfter)

        const quotes = await tx.commodityPriceQuote.findMany({
            where: {
                productId: {
                    in: productIds,
                },
                source: 'PLATTS',
                quoteDate: {
                    gte: fromDate,
                    lte: toDate,
                },
            },
            orderBy: {
                quoteDate: 'asc',
            },
        })

        if (!quotes.length) {
            throw new BadRequestException('PLATTS_PRICE_QUOTES_NOT_FOUND')
        }

        return quotes.map((x) => ({
            quoteDate: x.quoteDate.toISOString().slice(0, 10),
            priceUsdPerBbl: Number(x.priceUsdPerBbl),
        }))
    }

    private async createPriceDays(tx: Prisma.TransactionClient, stageId: string, dto: CalculateTermPricingDto, productIds: string[]) {
        const priceDays = await this.resolvePriceDaysFromPlatts(tx, dto, productIds)

        for (const day of priceDays) {
            await tx.purchasePricingPriceDay.create({
                data: {
                    stageId,
                    quoteDate: this.toDateOnly(day.quoteDate)!,
                    priceUsdPerBbl: new Prisma.Decimal(day.priceUsdPerBbl),
                },
            })
        }

        return priceDays
    }

    private async createCosts(tx: Prisma.TransactionClient, stageId: string, dto: CalculateTermPricingDto) {
        for (const cost of dto.costs || []) {
            await tx.purchasePricingStageCost.create({
                data: {
                    stageId,

                    costType: cost.costType,

                    amountVnd: new Prisma.Decimal(cost.amountVnd),

                    sourceDocNo: cost.sourceDocNo?.trim() || null,

                    note: cost.note?.trim() || null,
                },
            })
        }
    }

    private async recalculateStage(tx: Prisma.TransactionClient, stageId: string) {
        const stage = await tx.purchasePricingStage.findUnique({
            where: {
                id: stageId,
            },

            include: {
                lines: true,
                costs: true,
            },
        })

        if (!stage) {
            throw new NotFoundException('PRICING_STAGE_NOT_FOUND')
        }

        const unitUsdPerBbl = Number(stage.unitUsdPerBbl || 0)

        const fxRate = Number(stage.fxRate || 0)

        const unitVndPerLiter = this.usdPerBblToVndPerLiter(unitUsdPerBbl, fxRate)

        let totalAmountVnd = 0

        for (const line of stage.lines) {
            const qty = Number(line.qtyV15 || line.qtyActual || 0)

            const amountVnd = qty * unitVndPerLiter

            totalAmountVnd += amountVnd

            await tx.purchasePricingStageLine.update({
                where: {
                    id: line.id,
                },

                data: {
                    unitVndPerLiter: new Prisma.Decimal(unitVndPerLiter),

                    amountVnd: new Prisma.Decimal(amountVnd),
                },
            })
        }

        const totalCosts = stage.costs.reduce((sum: number, x: any) => sum + Number(x.amountVnd || 0), 0)

        totalAmountVnd += totalCosts

        totalAmountVnd += Number(stage.envTaxAmountVnd || 0)

        totalAmountVnd += Number(stage.vatAmountVnd || 0)

        await tx.purchasePricingStage.update({
            where: {
                id: stage.id,
            },

            data: {
                unitVndPerLiter: new Prisma.Decimal(unitVndPerLiter),

                totalAmountVnd: new Prisma.Decimal(totalAmountVnd),
            },
        })
    }

    private async createCostLayers(tx: Prisma.TransactionClient, order: any, runId: string, stageId: string) {
        const stage = await tx.purchasePricingStage.findUnique({
            where: {
                id: stageId,
            },

            include: {
                lines: true,
            },
        })

        if (!stage) {
            throw new NotFoundException('PRICING_STAGE_NOT_FOUND')
        }

        for (const line of stage.lines) {
            const qty = Number(line.qtyV15 || line.qtyActual || 0)

            if (qty <= 0) {
                continue
            }

            await tx.inventoryCostLayer.create({
                data: {
                    supplierCustomerId: order.supplierCustomerId,

                    supplierLocationId: line.supplierLocationId ?? '',

                    productId: line.productId,

                    sourceType: 'TERM_PRICING_FINAL',

                    sourceId: runId,

                    originalQty: new Prisma.Decimal(qty),

                    remainingQty: new Prisma.Decimal(qty),

                    unitCostPerLiter: line.unitVndPerLiter || new Prisma.Decimal(0),

                    totalCost: line.amountVnd || new Prisma.Decimal(0),

                    costDate: new Date(),

                    status: CostLayerStatus.OPEN,
                },
            })
        }
    }

    /*
     * =========================
     * Public APIs
     * =========================
     */

    async createEstimate(orderId: string, dto: CalculateTermPricingDto) {
        return this.createStage(orderId, dto, PricingStageType.ESTIMATE)
    }

    async createBillNormalize(orderId: string, dto: CalculateTermPricingDto) {
        return this.createStage(orderId, dto, PricingStageType.BILL_NORMALIZE)
    }

    async createFinal(orderId: string, dto: CalculateTermPricingDto) {
        return this.createStage(orderId, dto, PricingStageType.FINAL)
    }

    private async createStage(orderId: string, dto: CalculateTermPricingDto, stageType: PricingStageType) {
        const order = await this.getOrderForPricing(orderId)

        this.validateStageFlow(order, stageType)

        return this.prisma.$transaction(async (tx) => {
            const run = await this.getOrCreateRun(tx, order, dto)

            const stage = await this.createStageBase(tx, run.id, order, dto, stageType)

            await this.buildStageLines(tx, order, stage.id, dto)

            const productIds = order.lines.map((x: any) => x.productId)

            const priceDays = await this.createPriceDays(tx, stage.id, dto, productIds)

            if (priceDays.length && (dto.mopsAvgUsdPerBbl === undefined || dto.mopsAvgUsdPerBbl === null)) {
                const avg = priceDays.reduce((sum, x) => sum + Number(x.priceUsdPerBbl || 0), 0) / priceDays.length

                const premium = Number(dto.premiumUsdPerBbl ?? order.termPremiumUsdPerBbl ?? 0)

                await tx.purchasePricingStage.update({
                    where: {
                        id: stage.id,
                    },
                    data: {
                        mopsAvgUsdPerBbl: new Prisma.Decimal(avg),
                        premiumUsdPerBbl: new Prisma.Decimal(premium),
                        unitUsdPerBbl: new Prisma.Decimal(avg + premium),
                    },
                })
            }

            await this.createCosts(tx, stage.id, dto)

            await this.recalculateStage(tx, stage.id)

            if (stageType === PricingStageType.FINAL) {
                await this.createCostLayers(tx, order, run.id, stage.id)

                await tx.purchasePricingRun.update({
                    where: {
                        id: run.id,
                    },

                    data: {
                        status: PricingRunStatus.POSTED,
                    },
                })
            }

            return this.getStageDetail(stage.id)
        })
    }

    async getStageDetail(stageId: string) {
        return this.prisma.purchasePricingStage.findUnique({
            where: {
                id: stageId,
            },

            include: {
                lines: {
                    include: {
                        product: true,
                        supplierLocation: true,
                        purchaseOrderLine: true,
                    },
                },

                costs: true,

                priceDays: true,

                run: {
                    include: {
                        purchaseOrder: true,
                    },
                },
            },
        })
    }
}
