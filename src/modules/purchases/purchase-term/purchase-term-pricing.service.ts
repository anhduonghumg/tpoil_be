import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import {
    CostLayerStatus,
    FxStage,
    PricingRunStatus,
    PricingSheetRowType,
    PricingSheetValueType,
    PricingStageType,
    Prisma,
    PurchaseCostType,
    PurchaseBizType,
    PurchaseOrderStatus,
    QtyBasis,
    TermLogisticsCostStatus,
} from '@prisma/client'

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
                                sheetRows: true,
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

        const hasFinal = stages.some((x: any) => x.stageType === PricingStageType.FINAL)

        if (stageType === PricingStageType.BILL_NORMALIZE && !hasEstimate) {
            throw new BadRequestException('ESTIMATE_REQUIRED')
        }

        if (stageType === PricingStageType.FINAL && !hasBillNormalize) {
            throw new BadRequestException('BILL_NORMALIZE_REQUIRED')
        }

        if (stageType === PricingStageType.BOSS_SHEET && !hasFinal) {
            throw new BadRequestException('FINAL_STAGE_REQUIRED')
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
        const specialTax = Number(dto.specialConsumptionTaxUsdPerBbl ?? 0)

        return tx.purchasePricingStage.create({
            data: {
                runId,
                stageType,

                mopsAvgUsdPerBbl: new Prisma.Decimal(mops),
                premiumUsdPerBbl: new Prisma.Decimal(premium),
                specialConsumptionTaxUsdPerBbl: new Prisma.Decimal(specialTax),
                unitUsdPerBbl: new Prisma.Decimal(mops + premium + specialTax),

                fxRateDate: this.toDateOnly(dto.fxRateDate),
                fxStage: dto.fxStage ?? FxStage.ESTIMATE,
                fxRate: dto.fxRate !== undefined && dto.fxRate !== null ? new Prisma.Decimal(dto.fxRate) : null,

                billBarrelQty: dto.billBarrelQty !== undefined && dto.billBarrelQty !== null ? new Prisma.Decimal(dto.billBarrelQty) : null,

                tankQtyLiter: dto.tankQtyLiter !== undefined && dto.tankQtyLiter !== null ? new Prisma.Decimal(dto.tankQtyLiter) : null,

                insuranceRate: dto.insuranceRate !== undefined && dto.insuranceRate !== null ? new Prisma.Decimal(dto.insuranceRate) : null,

                inspectionFeeVnd: dto.inspectionFeeVnd !== undefined && dto.inspectionFeeVnd !== null ? new Prisma.Decimal(dto.inspectionFeeVnd) : null,

                transportFeeVnd: dto.transportFeeVnd !== undefined && dto.transportFeeVnd !== null ? new Prisma.Decimal(dto.transportFeeVnd) : null,

                storageFeeVnd: dto.storageFeeVnd !== undefined && dto.storageFeeVnd !== null ? new Prisma.Decimal(dto.storageFeeVnd) : null,

                transportLossRate: dto.transportLossRate !== undefined && dto.transportLossRate !== null ? new Prisma.Decimal(dto.transportLossRate) : null,

                envTaxVndPerLiter: dto.envTaxVndPerLiter !== undefined && dto.envTaxVndPerLiter !== null ? new Prisma.Decimal(dto.envTaxVndPerLiter) : null,

                extraCostVndPerLiter: dto.extraCostVndPerLiter !== undefined && dto.extraCostVndPerLiter !== null ? new Prisma.Decimal(dto.extraCostVndPerLiter) : null,

                retailPriceVndPerLiter: dto.retailPriceVndPerLiter !== undefined && dto.retailPriceVndPerLiter !== null ? new Prisma.Decimal(dto.retailPriceVndPerLiter) : null,

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
            return []
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
        for (const [index, cost] of (dto.costs || []).entries()) {
            await tx.purchasePricingStageCost.create({
                data: {
                    stageId,
                    costType: cost.costType,
                    name: cost.name?.trim() || null,
                    amountVnd: new Prisma.Decimal(cost.amountVnd),
                    sourceDocNo: cost.sourceDocNo?.trim() || null,
                    note: cost.note?.trim() || null,
                    sortOrder: cost.sortOrder ?? index + 1,
                },
            })
        }
    }

    private async createBossSheetLogisticsCosts(tx: Prisma.TransactionClient, purchaseOrderId: string, stageId: string) {
        const logisticsCosts = await tx.termLogisticsCost.findMany({
            where: {
                purchaseOrderId,
                status: {
                    in: [TermLogisticsCostStatus.CONFIRMED, TermLogisticsCostStatus.ALLOCATED, TermLogisticsCostStatus.POSTED],
                },
            },
            include: {
                vendor: true,
                lines: {
                    where: {
                        isCapitalizedToCost: true,
                    },
                    orderBy: {
                        sortOrder: 'asc',
                    },
                },
            },
            orderBy: {
                documentDate: 'asc',
            },
        })

        const mapCostType = (costType: string): PurchaseCostType => {
            switch (costType) {
                case 'INSURANCE':
                    return PurchaseCostType.INSURANCE
                case 'INSPECTION':
                    return PurchaseCostType.INSPECTION
                case 'STORAGE':
                    return PurchaseCostType.STORAGE
                case 'FREIGHT':
                case 'HANDLING':
                case 'PIPELINE_FEE':
                    return PurchaseCostType.TRANSPORT
                default:
                    return PurchaseCostType.OTHER
            }
        }

        const rows = logisticsCosts.flatMap((cost) =>
            cost.lines.map((line) => ({
                stageId,
                costType: mapCostType(line.costType),
                name: `${line.costType}${cost.vendor?.name ? ` - ${cost.vendor.name}` : ''}`,
                amountVnd: line.amountVndBeforeVat ?? new Prisma.Decimal(0),
                sourceDocNo: cost.documentNo,
                note: line.note ?? cost.note,
                sortOrder: line.sortOrder,
            })),
        )

        if (!rows.length) {
            return
        }

        await tx.purchasePricingStageCost.createMany({
            data: rows,
        })
    }

    private toNumber(value: any): number {
        if (value === null || value === undefined) return 0

        const n = Number(value)
        return Number.isFinite(n) ? n : 0
    }

    private async recalculateStage(tx: Prisma.TransactionClient, stageId: string) {
        const stage = await tx.purchasePricingStage.findUnique({
            where: { id: stageId },
            include: {
                priceDays: true,
                costs: true,
                lines: true,
            },
        })

        if (!stage) {
            throw new BadRequestException('PURCHASE_PRICING_STAGE_NOT_FOUND')
        }

        const priceDays = stage.priceDays ?? []

        const avgPlatts = priceDays.length > 0 ? priceDays.reduce((sum, x) => sum + this.toNumber(x.priceUsdPerBbl), 0) / priceDays.length : this.toNumber(stage.mopsAvgUsdPerBbl)

        const premium = this.toNumber(stage.premiumUsdPerBbl)
        const specialTax = this.toNumber(stage.specialConsumptionTaxUsdPerBbl)

        const unitUsdPerBbl = avgPlatts + premium + specialTax

        const billBarrelQty = this.toNumber(stage.billBarrelQty)
        const paymentAmountUsd = unitUsdPerBbl * billBarrelQty

        const fxRate = this.toNumber(stage.fxRate)

        const insuranceRate = this.toNumber(stage.insuranceRate)
        const insuranceAmountVnd = paymentAmountUsd * fxRate * insuranceRate

        const inspectionFeeVnd = this.toNumber(stage.inspectionFeeVnd)
        const transportFeeVnd = this.toNumber(stage.transportFeeVnd)
        const storageFeeVnd = this.toNumber(stage.storageFeeVnd)

        const transportLossRate = this.toNumber(stage.transportLossRate)
        const transportLossAmountVnd = paymentAmountUsd * fxRate * transportLossRate

        const extraStageCosts = stage.costs.reduce((sum, x) => sum + this.toNumber(x.amountVnd), 0)

        const billTotalVnd = paymentAmountUsd * fxRate + insuranceAmountVnd + inspectionFeeVnd + transportFeeVnd + storageFeeVnd + transportLossAmountVnd + extraStageCosts

        const tankQtyLiter = this.toNumber(stage.tankQtyLiter)

        const tankUnitPriceVndPerLiter = tankQtyLiter > 0 ? billTotalVnd / tankQtyLiter : 0

        const envTaxVndPerLiter = this.toNumber(stage.envTaxVndPerLiter)
        const extraCostVndPerLiter = this.toNumber(stage.extraCostVndPerLiter)

        const sellingUnitPriceVndPerLiter = tankUnitPriceVndPerLiter + envTaxVndPerLiter + extraCostVndPerLiter

        const temporaryAmountVnd = sellingUnitPriceVndPerLiter * tankQtyLiter

        const retailPriceVndPerLiter = this.toNumber(stage.retailPriceVndPerLiter)

        const discountVndPerLiter = retailPriceVndPerLiter > 0 ? retailPriceVndPerLiter - sellingUnitPriceVndPerLiter : 0

        for (const line of stage.lines) {
            const qty = this.toNumber(line.qtyV15 ?? line.qtyActual)

            await tx.purchasePricingStageLine.update({
                where: { id: line.id },
                data: {
                    unitVndPerLiter: new Prisma.Decimal(sellingUnitPriceVndPerLiter),
                    amountVnd: new Prisma.Decimal(qty * sellingUnitPriceVndPerLiter),
                },
            })
        }

        await tx.purchasePricingStage.update({
            where: { id: stage.id },
            data: {
                mopsAvgUsdPerBbl: new Prisma.Decimal(avgPlatts),
                unitUsdPerBbl: new Prisma.Decimal(unitUsdPerBbl),
                amountUsd: new Prisma.Decimal(paymentAmountUsd),

                paymentAmountUsd: new Prisma.Decimal(paymentAmountUsd),

                insuranceAmountVnd: new Prisma.Decimal(insuranceAmountVnd),
                transportLossAmountVnd: new Prisma.Decimal(transportLossAmountVnd),

                billTotalVnd: new Prisma.Decimal(billTotalVnd),
                tankUnitPriceVndPerLiter: new Prisma.Decimal(tankUnitPriceVndPerLiter),
                sellingUnitPriceVndPerLiter: new Prisma.Decimal(sellingUnitPriceVndPerLiter),
                temporaryAmountVnd: new Prisma.Decimal(temporaryAmountVnd),
                discountVndPerLiter: new Prisma.Decimal(discountVndPerLiter),

                totalAmountVnd: new Prisma.Decimal(temporaryAmountVnd),
                unitVndPerLiter: new Prisma.Decimal(sellingUnitPriceVndPerLiter),
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

            if (stageType === PricingStageType.BOSS_SHEET) {
                await this.createBossSheetLogisticsCosts(tx, order.id, stage.id)
            }

            await this.recalculateStage(tx, stage.id)

            await this.buildSheetRows(tx, stage.id)

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
            } else if (stageType === PricingStageType.ESTIMATE) {
                await tx.purchasePricingRun.update({
                    where: {
                        id: run.id,
                    },
                    data: {
                        status: PricingRunStatus.ESTIMATED,
                    },
                })
            } else if (stageType === PricingStageType.BILL_NORMALIZE) {
                await tx.purchasePricingRun.update({
                    where: {
                        id: run.id,
                    },
                    data: {
                        status: PricingRunStatus.NORMALIZED,
                    },
                })
            } else if (stageType === PricingStageType.BOSS_SHEET) {
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
                priceDays: {
                    orderBy: {
                        quoteDate: 'asc',
                    },
                },
                costs: {
                    orderBy: {
                        sortOrder: 'asc',
                    },
                },
                sheetRows: {
                    orderBy: {
                        sortOrder: 'asc',
                    },
                },
                lines: {
                    include: {
                        product: true,
                        supplierLocation: true,
                        purchaseOrderLine: true,
                    },
                    orderBy: {
                        createdAt: 'asc',
                    },
                },
                run: {
                    include: {
                        purchaseOrder: true,
                    },
                },
            },
        })
    }

    private async buildSheetRows(tx: Prisma.TransactionClient, stageId: string) {
        const stage = await tx.purchasePricingStage.findUnique({
            where: { id: stageId },
            include: {
                priceDays: {
                    orderBy: {
                        quoteDate: 'asc',
                    },
                },
                costs: {
                    orderBy: {
                        sortOrder: 'asc',
                    },
                },
            },
        })

        if (!stage) {
            throw new BadRequestException('PURCHASE_PRICING_STAGE_NOT_FOUND')
        }

        await tx.purchasePricingSheetRow.deleteMany({
            where: {
                stageId,
            },
        })

        const rows: Prisma.PurchasePricingSheetRowCreateManyInput[] = []

        let rowNo = 1

        for (const day of stage.priceDays) {
            rows.push({
                stageId,
                rowNo,
                sortOrder: rowNo,
                code: `PRICE_DAY_${rowNo}`,
                label: day.quoteDate.toISOString().slice(0, 10),
                rowType: PricingSheetRowType.PRICE_DAY,
                valueType: PricingSheetValueType.NUMBER,
                calculatedValue: day.priceUsdPerBbl,
                unit: 'USD/thùng',
                note: rowNo === 1 ? 'Giá Platts' : null,
            })

            rowNo++
        }

        const addRow = (args: {
            code: string
            label: string
            value?: Prisma.Decimal | number | null
            unit?: string
            formula?: string
            note?: string
            rowType?: PricingSheetRowType
            valueType?: PricingSheetValueType
            isInput?: boolean
            isResult?: boolean
            isBold?: boolean
            isHighlighted?: boolean
        }) => {
            rows.push({
                stageId,
                rowNo,
                sortOrder: rowNo,
                code: args.code,
                label: args.label,
                rowType: args.rowType ?? PricingSheetRowType.FORMULA,
                valueType: args.valueType ?? PricingSheetValueType.NUMBER,
                calculatedValue: args.value === undefined || args.value === null ? null : new Prisma.Decimal(args.value),
                unit: args.unit ?? null,
                formula: args.formula ?? null,
                note: args.note ?? null,
                isInput: args.isInput ?? false,
                isResult: args.isResult ?? false,
                isBold: args.isBold ?? false,
                isHighlighted: args.isHighlighted ?? false,
            })

            rowNo++
        }

        addRow({
            code: 'AVG_PLATTS',
            label: 'Giá trung bình Platts',
            value: stage.mopsAvgUsdPerBbl,
            unit: 'USD',
            note: 'Trung bình các ngày Platts',
            isBold: true,
        })

        addRow({
            code: 'PREMIUM',
            label: 'Premium',
            value: stage.premiumUsdPerBbl,
            unit: 'USD',
            rowType: PricingSheetRowType.INPUT,
            isInput: true,
        })

        addRow({
            code: 'FOB_NS',
            label: 'FOB NS',
            value: stage.unitUsdPerBbl,
            unit: 'USD',
            formula: 'Giá trung bình Platts + Premium + Thuế TTĐB',
            isBold: true,
        })

        addRow({
            code: 'BILL_BARREL_QTY',
            label: 'Số thùng BILL',
            value: stage.billBarrelQty,
            unit: 'thùng',
            rowType: PricingSheetRowType.INPUT,
            isInput: true,
        })

        addRow({
            code: 'PAYMENT_AMOUNT_USD',
            label: 'Số tiền thanh toán',
            value: stage.paymentAmountUsd,
            unit: 'USD',
            formula: 'Đơn giá/thùng * Số thùng BILL',
            isBold: true,
        })

        addRow({
            code: 'FX_RATE',
            label: 'Tỷ giá VCB',
            value: stage.fxRate,
            unit: 'VND/USD',
            rowType: PricingSheetRowType.INPUT,
            isInput: true,
        })

        addRow({
            code: 'INSURANCE',
            label: 'Bảo hiểm hàng hóa',
            value: stage.insuranceAmountVnd,
            unit: 'VND',
            rowType: PricingSheetRowType.COST,
        })

        for (const cost of stage.costs) {
            addRow({
                code: `COST_${cost.costType}_${cost.id}`,
                label: cost.name || cost.costType,
                value: cost.amountVnd,
                unit: 'VND',
                rowType: PricingSheetRowType.COST,
                note: cost.note ?? undefined,
            })
        }

        addRow({
            code: 'TRANSPORT_LOSS',
            label: 'Hao hụt vận chuyển',
            value: stage.transportLossAmountVnd,
            unit: 'VND',
            rowType: PricingSheetRowType.COST,
        })

        addRow({
            code: 'BILL_TOTAL_VND',
            label: 'Tổng tiền BILL',
            value: stage.billTotalVnd,
            unit: 'VND',
            formula: 'Tiền hàng + chi phí',
            rowType: PricingSheetRowType.RESULT,
            isResult: true,
            isBold: true,
            isHighlighted: true,
        })

        addRow({
            code: 'TANK_QTY',
            label: 'Số lượng bồn',
            value: stage.tankQtyLiter,
            unit: 'lit',
            rowType: PricingSheetRowType.INPUT,
            isInput: true,
        })

        addRow({
            code: 'TANK_UNIT_PRICE',
            label: 'Đơn giá/Lít TT bồn',
            value: stage.tankUnitPriceVndPerLiter,
            unit: 'VND/lit',
            rowType: PricingSheetRowType.RESULT,
            isBold: true,
        })

        addRow({
            code: 'ENV_TAX_PER_LITER',
            label: 'Thuế BVMT',
            value: stage.envTaxVndPerLiter,
            unit: 'VND/lit',
            rowType: PricingSheetRowType.TAX,
            isInput: true,
        })

        addRow({
            code: 'EXTRA_COST_PER_LITER',
            label: 'Chi phí phát sinh',
            value: stage.extraCostVndPerLiter,
            unit: 'VND/lit',
            rowType: PricingSheetRowType.COST,
            isInput: true,
        })

        addRow({
            code: 'SELLING_UNIT_PRICE',
            label: 'Đơn giá bán',
            value: stage.sellingUnitPriceVndPerLiter,
            unit: 'VND/lit',
            rowType: PricingSheetRowType.RESULT,
            isBold: true,
        })

        addRow({
            code: 'TEMP_AMOUNT',
            label: 'Thành tiền tạm tính',
            value: stage.temporaryAmountVnd,
            unit: 'VND',
            rowType: PricingSheetRowType.RESULT,
            isResult: true,
            isBold: true,
            isHighlighted: true,
        })

        await tx.purchasePricingSheetRow.createMany({
            data: rows,
        })
    }

    async createBossSheet(orderId: string, dto: CalculateTermPricingDto) {
        return this.createStage(orderId, dto, PricingStageType.BOSS_SHEET)
    }
}
