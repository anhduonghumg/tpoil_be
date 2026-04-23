import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CostLayerStatus, FxStage, GoodsReceiptStatus, PriceSource, PricingRunStatus, PricingStageType, PurchaseBizType, PurchaseCostType, QtyBasis } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CalculateTermPricingDto } from './dto/calculate-term-pricing.dto'

@Injectable()
export class PurchaseTermPricingService {
    constructor(private readonly prisma: PrismaService) {}

    private litersPerBbl = 158.987295

    private async resolveMops(productId: string, billDate: string, override?: number) {
        if (override != null) return override

        const quote = await this.prisma.commodityPriceQuote.findFirst({
            where: {
                productId,
                quoteDate: new Date(billDate),
                source: PriceSource.PLATTS,
            },
            orderBy: { quoteDate: 'desc' },
        })

        if (!quote) throw new NotFoundException('TERM_PRICE_QUOTE_NOT_FOUND')
        return Number(quote.priceUsdPerBbl)
    }
    private async resolveFx(fxRateDate: string | undefined, override?: number, stage?: FxStage) {
        if (override != null) return override
        const date = fxRateDate ? new Date(fxRateDate) : undefined

        const fx = await this.prisma.exchangeRate.findFirst({
            where: {
                base: 'USD',
                quote: 'VND',
                stage: stage ?? FxStage.ESTIMATE,
                rateDate: date ?? undefined,
            },
            orderBy: { rateDate: 'desc' },
        })

        if (!fx) throw new NotFoundException('TERM_EXCHANGE_RATE_NOT_FOUND')
        return Number(fx.rate)
    }

    async calculate(purchaseOrderId: string, dto: CalculateTermPricingDto) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id: purchaseOrderId, bizType: PurchaseBizType.TERM },
            include: {
                supplier: true,
                supplierLocation: true,
                lines: {
                    include: {
                        product: true,
                        supplierLocation: true,
                    },
                },
                receipts: true,
            },
        })

        if (!order) throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')

        const line = order.lines.find((x) => x.id === dto.purchaseOrderLineId)
        if (!line) throw new BadRequestException('TERM_PURCHASE_ORDER_LINE_NOT_FOUND')

        const matchedReceipts = dto.receipts?.length
            ? await this.prisma.goodsReceipt.findMany({
                  where: {
                      id: { in: dto.receipts.map((x) => x.goodsReceiptId) },
                      purchaseOrderId,
                      purchaseOrderLineId: dto.purchaseOrderLineId,
                      status: GoodsReceiptStatus.CONFIRMED,
                  },
              })
            : await this.prisma.goodsReceipt.findMany({
                  where: {
                      purchaseOrderId,
                      purchaseOrderLineId: dto.purchaseOrderLineId,
                      status: GoodsReceiptStatus.CONFIRMED,
                  },
              })

        if (!matchedReceipts.length) {
            throw new BadRequestException('TERM_PRICING_CONFIRMED_RECEIPT_REQUIRED')
        }

        const qtyActualTotal = dto.qtyActualTotal ?? matchedReceipts.reduce((sum, x) => sum + Number(x.qty || 0), 0)
        const qtyV15Total = dto.qtyV15Total ?? matchedReceipts.reduce((sum, x) => sum + Number(x.standardQtyV15 || x.qty || 0), 0)

        const qtyUsed = dto.qtyBasisSelected === QtyBasis.V15 ? qtyV15Total : qtyActualTotal
        if (!qtyUsed || qtyUsed <= 0) {
            throw new BadRequestException('TERM_PRICING_QTY_INVALID')
        }

        const mopsAvgUsdPerBbl = await this.resolveMops(line.productId, dto.billDate, dto.mopsAvgUsdPerBbl)
        const premiumUsdPerBbl = Number(dto.premiumUsdPerBbl || 0)
        const unitUsdPerBbl = mopsAvgUsdPerBbl + premiumUsdPerBbl
        const amountUsd = (unitUsdPerBbl / this.litersPerBbl) * qtyUsed

        const fxRate = await this.resolveFx(dto.fxRateDate, dto.fxRate, dto.fxStage)
        const amountVndBeforeTax = amountUsd * fxRate

        const costTotal = (dto.costs ?? []).reduce((sum, x) => sum + Number(x.amountVnd || 0), 0)
        const envTaxAmountVnd = Number(dto.envTaxAmountVnd || 0)
        const vatAmountVnd = Number(dto.vatAmountVnd || 0)
        const totalAmountVnd = amountVndBeforeTax + costTotal + envTaxAmountVnd + vatAmountVnd
        const unitVndPerLiter = totalAmountVnd / qtyUsed

        const stageStatusMap: Record<PricingStageType, PricingRunStatus> = {
            ESTIMATE: PricingRunStatus.ESTIMATED,
            BILL_NORMALIZE: PricingRunStatus.NORMALIZED,
            FINAL: PricingRunStatus.FINAL_READY,
        }

        const run = await this.prisma.$transaction(async (tx) => {
            const existingRun = await tx.purchasePricingRun.findFirst({
                where: {
                    purchaseOrderId,
                    purchaseOrderLineId: dto.purchaseOrderLineId,
                    billDate: new Date(dto.billDate),
                },
                orderBy: { createdAt: 'desc' },
            })

            if (existingRun && existingRun.status === PricingRunStatus.POSTED) {
                throw new BadRequestException('TERM_PRICING_RUN_ALREADY_POSTED_NOT_EDITABLE')
            }

            const run = existingRun
                ? await tx.purchasePricingRun.update({
                      where: { id: existingRun.id },
                      data: {
                          supplierCustomerId: order.supplierCustomerId,
                          productId: line.productId,
                          qtyBasisSelected: dto.qtyBasisSelected,
                          qtyBasisLocked: dto.qtyBasisLocked ?? false,
                          qtyActualTotal,
                          qtyV15Total,
                          status: stageStatusMap[dto.stageType],
                      },
                  })
                : await tx.purchasePricingRun.create({
                      data: {
                          purchaseOrderId,
                          purchaseOrderLineId: dto.purchaseOrderLineId,
                          supplierCustomerId: order.supplierCustomerId,
                          productId: line.productId,
                          billDate: dto.billDate,
                          qtyBasisSelected: dto.qtyBasisSelected,
                          qtyBasisLocked: dto.qtyBasisLocked ?? false,
                          qtyActualTotal,
                          qtyV15Total,
                          status: stageStatusMap[dto.stageType],
                      },
                  })

            await tx.purchasePricingRunReceipt.deleteMany({ where: { runId: run.id } })
            if (matchedReceipts.length) {
                await tx.purchasePricingRunReceipt.createMany({
                    data: matchedReceipts.map((receipt) => {
                        const receiptInput = dto.receipts?.find((x) => x.goodsReceiptId === receipt.id)
                        return {
                            runId: run.id,
                            goodsReceiptId: receipt.id,
                            qtyActualUsed: receiptInput?.qtyActualUsed ?? Number(receipt.qty || 0),
                            qtyV15Used: receiptInput?.qtyV15Used ?? Number(receipt.standardQtyV15 || receipt.qty || 0),
                        }
                    }),
                })
            }

            const stage = await tx.purchasePricingStage.upsert({
                where: {
                    runId_stageType: {
                        runId: run.id,
                        stageType: dto.stageType,
                    },
                },
                update: {
                    mopsAvgUsdPerBbl,
                    premiumUsdPerBbl,
                    unitUsdPerBbl,
                    amountUsd,
                    fxRateDate: dto.fxRateDate ? new Date(dto.fxRateDate) : null,
                    fxStage: dto.fxStage ?? FxStage.ESTIMATE,
                    fxRate,
                    envTaxAmountVnd,
                    vatAmountVnd,
                    amountVndBeforeTax,
                    totalAmountVnd,
                    unitVndPerLiter,
                    note: dto.note ?? null,
                    insuranceAmountVnd: null,
                    shippingFeeVnd: null,
                    otherFeeVnd: null,
                },
                create: {
                    runId: run.id,
                    stageType: dto.stageType,
                    mopsAvgUsdPerBbl,
                    premiumUsdPerBbl,
                    unitUsdPerBbl,
                    amountUsd,
                    fxRateDate: dto.fxRateDate ? new Date(dto.fxRateDate) : null,
                    fxStage: dto.fxStage ?? FxStage.ESTIMATE,
                    fxRate,
                    envTaxAmountVnd,
                    vatAmountVnd,
                    amountVndBeforeTax,
                    totalAmountVnd,
                    unitVndPerLiter,
                    note: dto.note ?? null,
                    insuranceAmountVnd: null,
                    shippingFeeVnd: null,
                    otherFeeVnd: null,
                },
            })

            await tx.purchasePricingStageCost.deleteMany({ where: { stageId: stage.id } })
            if (dto.costs?.length) {
                await tx.purchasePricingStageCost.createMany({
                    data: dto.costs.map((cost) => ({
                        stageId: stage.id || '',
                        costType: cost.costType as PurchaseCostType,
                        amountVnd: cost.amountVnd || 0,
                        sourceDocNo: cost.sourceDocNo ?? null,
                        note: cost.note ?? null,
                    })),
                })
            }

            return run
        })

        return this.findRunById(run.id)
    }

    async listByOrder(purchaseOrderId: string) {
        return this.prisma.purchasePricingRun.findMany({
            where: { purchaseOrderId },
            include: {
                product: true,
                purchaseOrderLine: {
                    include: {
                        supplierLocation: true,
                        product: true,
                    },
                },
                stages: {
                    include: {
                        costs: true,
                        priceDays: true,
                    },
                },
                receipts: {
                    include: {
                        goodsReceipt: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        })
    }

    async findRunById(id: string) {
        const run = await this.prisma.purchasePricingRun.findUnique({
            where: { id },
            include: {
                product: true,
                purchaseOrder: true,
                purchaseOrderLine: {
                    include: {
                        supplierLocation: true,
                        product: true,
                    },
                },
                stages: {
                    include: {
                        costs: true,
                        priceDays: true,
                    },
                    orderBy: { stageType: 'asc' },
                },
                receipts: {
                    include: {
                        goodsReceipt: true,
                    },
                },
            },
        })

        if (!run) throw new NotFoundException('TERM_PRICING_RUN_NOT_FOUND')
        return run
    }

    async postRun(id: string) {
        const run = await this.prisma.purchasePricingRun.findUnique({
            where: { id },
            include: {
                purchaseOrder: true,
                purchaseOrderLine: true,
                stages: true,
            },
        })

        if (!run) {
            throw new NotFoundException('TERM_PRICING_RUN_NOT_FOUND')
        }

        const finalStage = run.stages.find((x) => x.stageType === PricingStageType.FINAL)
        if (!finalStage) {
            throw new BadRequestException('TERM_PRICING_FINAL_STAGE_REQUIRED')
        }

        if (run.status === PricingRunStatus.POSTED) {
            throw new BadRequestException('TERM_PRICING_ALREADY_POSTED')
        }

        const qtyUsed = run.qtyBasisSelected === QtyBasis.V15 ? Number(run.qtyV15Total || 0) : Number(run.qtyActualTotal || 0)

        if (qtyUsed <= 0) {
            throw new BadRequestException('TERM_PRICING_QTY_INVALID')
        }

        const unitCostPerLiter = Number(finalStage.unitVndPerLiter || 0)
        if (unitCostPerLiter <= 0) {
            throw new BadRequestException('TERM_PRICING_UNIT_COST_INVALID')
        }

        const totalCost = Number(finalStage.totalAmountVnd || 0)
        if (totalCost <= 0) {
            throw new BadRequestException('TERM_PRICING_TOTAL_COST_INVALID')
        }

        const supplierLocationId = run.purchaseOrderLine?.supplierLocationId || run.purchaseOrder?.supplierLocationId
        if (!supplierLocationId) {
            throw new BadRequestException('TERM_PRICING_SUPPLIER_LOCATION_REQUIRED')
        }

        const existedLayer = await this.prisma.inventoryCostLayer.findFirst({
            where: {
                sourceType: 'TERM_PRICING',
                sourceId: run.id,
            },
        })

        if (existedLayer) {
            throw new BadRequestException('TERM_PRICING_COST_LAYER_ALREADY_CREATED')
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.inventoryCostLayer.create({
                data: {
                    supplierCustomerId: run.supplierCustomerId,
                    supplierLocationId,
                    productId: run.productId,
                    sourceType: 'TERM_PRICING',
                    sourceId: run.id,
                    originalQty: qtyUsed,
                    remainingQty: qtyUsed,
                    unitCostPerLiter,
                    totalCost,
                    costDate: run.billDate,
                    status: CostLayerStatus.OPEN,
                },
            })

            await tx.purchasePricingRun.update({
                where: { id },
                data: {
                    status: PricingRunStatus.POSTED,
                },
            })
        })

        return this.findRunById(id)
    }
}
