import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import {
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
import { createHash } from 'node:crypto'
import pdf = require('pdf-parse')
import Tesseract = require('tesseract.js')

type ImportedPricingFields = {
    billDate?: string
    plattsBaseDate?: string
    priceDays?: Array<{ quoteDate: string; priceUsdPerBbl: number }>
    mopsAvgUsdPerBbl?: number
    premiumUsdPerBbl?: number
    specialConsumptionTaxUsdPerBbl?: number
    fxRateDate?: string
    fxRate?: number
    billBarrelQty?: number
    tankQtyLiter?: number
    insuranceAmountVnd?: number
    inspectionFeeVnd?: number
    transportFeeVnd?: number
    storageFeeVnd?: number
    transportLossAmountVnd?: number
    transportDeductionVnd?: number
    envTaxVndPerLiter?: number
    extraCostVndPerLiter?: number
    fundAdjustmentVndPerLiter?: number
    contractPaymentRate?: number
    bankGuaranteeRate?: number
    note?: string
}

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

    private stripVietnamese(value: string) {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase()
    }

    private parseVietnameseNumber(value?: string | null): number | undefined {
        if (!value) {
            return undefined
        }

        const cleaned = value.replace(/[^\d,.-]/g, '').trim()

        if (!cleaned) {
            return undefined
        }

        const normalized = cleaned.includes(',')
            ? cleaned.replace(/\./g, '').replace(',', '.')
            : cleaned.replace(/\./g, '')

        const numberValue = Number(normalized)

        return Number.isFinite(numberValue) ? numberValue : undefined
    }

    private parseQuoteNumber(value?: string | null): number | undefined {
        if (!value) {
            return undefined
        }

        const cleaned = value.replace(/[^\d,.-]/g, '').trim()

        if (!cleaned) {
            return undefined
        }

        const normalized = cleaned.includes(',')
            ? cleaned.replace(/\./g, '').replace(',', '.')
            : cleaned.replace(',', '.')

        const numberValue = Number(normalized)

        return Number.isFinite(numberValue) ? numberValue : undefined
    }

    private parseMoneyNumber(value?: string | null): number | undefined {
        if (!value) {
            return undefined
        }

        const cleaned = value.replace(/[^\d,.-]/g, '').trim()

        if (!cleaned) {
            return undefined
        }

        const numberValue = Number(cleaned.replace(/[.,]/g, ''))

        return Number.isFinite(numberValue) ? numberValue : undefined
    }

    private parseVietnameseDate(value?: string | null): string | undefined {
        if (!value) {
            return undefined
        }

        const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)

        if (!match) {
            return undefined
        }

        const day = match[1].padStart(2, '0')
        const month = match[2].padStart(2, '0')
        const year = match[3]

        return `${year}-${month}-${day}`
    }

    private extractNumbers(line: string) {
        const matches = line.match(/-?\d{1,3}(?:[.,]\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/g) ?? []
        return matches.map((item) => this.parseVietnameseNumber(item)).filter((item): item is number => item !== undefined)
    }

    private lastNumberFromLine(line?: string) {
        if (!line) {
            return undefined
        }

        const numbers = this.extractNumbers(line)
        return numbers.length ? numbers[numbers.length - 1] : undefined
    }

    private lastMoneyFromLine(line?: string) {
        if (!line) {
            return undefined
        }

        const matches = line.match(/-?\d{1,3}(?:[.,]\d{3}){2,}|-?\d{4,}/g) ?? []
        const values = matches.map((item) => this.parseMoneyNumber(item)).filter((item): item is number => item !== undefined)
        return values.length ? values[values.length - 1] : undefined
    }

    private findLine(lines: string[], keywords: string[]) {
        const normalizedKeywords = keywords.map((item) => this.stripVietnamese(item))

        return lines.find((line) => {
            const normalizedLine = this.stripVietnamese(line)
            return normalizedKeywords.every((keyword) => normalizedLine.includes(keyword))
        })
    }

    private findLineAny(lines: string[], keywordSets: string[][]) {
        for (const keywords of keywordSets) {
            const line = this.findLine(lines, keywords)
            if (line) {
                return line
            }
        }

        return undefined
    }

    private async readImageText(file: Express.Multer.File) {
        const worker = await Tesseract.createWorker(['vie', 'eng'], Tesseract.OEM.LSTM_ONLY, {
            cachePath: '.cache/tesseract',
        })

        try {
            await worker.setParameters({
                preserve_interword_spaces: '1',
                user_defined_dpi: '300',
                tessedit_pageseg_mode: Tesseract.PSM.AUTO,
            })

            const result = await worker.recognize(file.buffer)
            return result.data.text || ''
        } finally {
            await worker.terminate()
        }
    }

    private extractPricingSheetFields(text: string) {
        const warnings: string[] = []
        const lines = text
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)

        const fields: ImportedPricingFields = {
            insuranceAmountVnd: 0,
            inspectionFeeVnd: 0,
            transportFeeVnd: 0,
            storageFeeVnd: 0,
            transportLossAmountVnd: 0,
            transportDeductionVnd: 0,
            specialConsumptionTaxUsdPerBbl: 0,
            contractPaymentRate: 100,
            bankGuaranteeRate: 0,
        }

        const priceDays: Array<{ quoteDate: string; priceUsdPerBbl: number }> = []
        const dateValueRegex = /^\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s+(\d{1,3}(?:[.,]\d{1,3})?)\s*$/

        for (const line of lines) {
            const dateValueMatch = line.match(dateValueRegex)
            const quoteDate = this.parseVietnameseDate(dateValueMatch?.[1])
            const priceUsdPerBbl = this.parseQuoteNumber(dateValueMatch?.[2])

            if (quoteDate && priceUsdPerBbl !== undefined && priceUsdPerBbl > 0 && priceUsdPerBbl < 1000) {
                priceDays.push({ quoteDate, priceUsdPerBbl })
            }
        }

        if (priceDays.length) {
            fields.priceDays = priceDays.slice(0, 11)
            fields.plattsBaseDate = fields.priceDays[fields.priceDays.length - 1]?.quoteDate
            fields.mopsAvgUsdPerBbl =
                fields.priceDays.reduce((sum, item) => sum + item.priceUsdPerBbl, 0) / fields.priceDays.length
        }

        const mops = this.lastNumberFromLine(this.findLine(lines, ['gia trung binh', 'mops']))
        const premium = this.lastNumberFromLine(this.findLineAny(lines, [['premium'], ['prem'], ['rem']]))
        const fob = this.lastNumberFromLine(this.findLine(lines, ['fob']))
        const literQty = this.lastNumberFromLine(this.findLineAny(lines, [['so luong lit'], ['so luong', 'thuc te'], ['so luong', 'it']]))
        const barrelQty = this.lastNumberFromLine(this.findLineAny(lines, [['so luong thung'], ['so luong thing'], ['so luong', 'thing']]))
        const fxLine = this.findLine(lines, ['ty gia'])
        const fxRate = this.lastNumberFromLine(fxLine)
        const envTax = this.lastNumberFromLine(this.findLine(lines, ['thue moi truong']))
        const fundAdjustment = this.lastNumberFromLine(this.findLine(lines, ['quy binh on'])) ?? this.lastNumberFromLine(this.findLine(lines, ['trich', 'chi quy']))
        const extraCostPerLiter = this.lastNumberFromLine(this.findLineAny(lines, [['chi phi khac'], ['chi phi khac']]))
        const beforeVatAmount = this.lastMoneyFromLine(this.findLineAny(lines, [['thanh tien truoc thue'], ['thanh tien truoc thue vat']]))
        const contractAmount = this.lastMoneyFromLine(this.findLineAny(lines, [['gia tri thanh toan truoc'], ['gia tri thanh toan truoc theo hop dong']]))

        if (mops !== undefined) {
            const calculatedMops = fields.priceDays?.length
                ? fields.priceDays.reduce((sum, item) => sum + item.priceUsdPerBbl, 0) / fields.priceDays.length
                : undefined

            if (calculatedMops !== undefined && Math.abs(calculatedMops - mops) > 0.01) {
                warnings.push('Trung bình 11 ngày giá lệch với dòng MOPS trên file, cần kiểm tra lại ngày giá OCR.')
            }

            fields.mopsAvgUsdPerBbl = mops
        }
        if (premium !== undefined) fields.premiumUsdPerBbl = premium
        if (literQty !== undefined) fields.tankQtyLiter = literQty
        if (barrelQty !== undefined) fields.billBarrelQty = barrelQty
        if (fxRate !== undefined) fields.fxRate = fxRate
        if (envTax !== undefined) fields.envTaxVndPerLiter = envTax
        if (fundAdjustment !== undefined) fields.fundAdjustmentVndPerLiter = fundAdjustment

        if (extraCostPerLiter !== undefined) {
            fields.extraCostVndPerLiter = fields.tankQtyLiter ? extraCostPerLiter * fields.tankQtyLiter : extraCostPerLiter
        }

        if (fob !== undefined && fields.mopsAvgUsdPerBbl !== undefined && fields.premiumUsdPerBbl !== undefined) {
            fields.specialConsumptionTaxUsdPerBbl = Number((fob - fields.mopsAvgUsdPerBbl - fields.premiumUsdPerBbl).toFixed(3))
        }

        if (fxLine) {
            const fxDate = this.parseVietnameseDate(fxLine)
            if (fxDate) {
                fields.fxRateDate = fxDate
            }
        }

        if (contractAmount !== undefined && beforeVatAmount && beforeVatAmount > 0) {
            fields.contractPaymentRate = Number(((contractAmount / beforeVatAmount) * 100).toFixed(3))
        }

        const deliveryLine = this.findLine(lines, ['ngay giao nhan'])
        const receivingModeLine = this.findLine(lines, ['hinh thuc nhan hang'])
        const warehouseLine = this.findLine(lines, ['kho den'])
        const productLine = this.findLine(lines, ['san pham'])
        const noteParts = [deliveryLine, receivingModeLine, warehouseLine, productLine].filter(Boolean)

        if (noteParts.length) {
            fields.note = noteParts.join('\n')
        }

        if (!fields.priceDays?.length) {
            warnings.push('Không đọc được 11 ngày giá Platts từ file.')
        }

        if (!fields.fxRate) {
            warnings.push('Không đọc được tỷ giá tạm tính từ file.')
        }

        if (!fields.tankQtyLiter) {
            warnings.push('Không đọc được số lượng lít từ file.')
        }

        return { fields, warnings }
    }

    async importPricingSheetPreview(file: Express.Multer.File) {
        const mimeType = file.mimetype || ''
        const originalName = file.originalname || ''

        let text = ''
        let sourceType = 'TEXT'

        if (mimeType.startsWith('image/')) {
            text = await this.readImageText(file)
            sourceType = 'IMAGE_OCR'
        } else if (mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf')) {
            const parsed = await pdf(file.buffer)
            text = parsed.text || ''
            sourceType = 'PDF_TEXT'
        } else if (mimeType.startsWith('text/') || originalName.toLowerCase().endsWith('.txt')) {
            text = file.buffer.toString('utf8')
        } else {
            throw new BadRequestException('Chỉ hỗ trợ PDF có text, TXT hoặc ảnh sau khi cấu hình OCR')
        }

        if (!text.trim()) {
            return {
                supported: false,
                sourceType,
                message: 'File không có text để bóc dữ liệu.',
                fields: {},
                warnings: ['Không đọc được text trong file.'],
            }
        }

        const result = this.extractPricingSheetFields(text)
        const extractedCount = Object.values(result.fields).filter((value) => {
            if (Array.isArray(value)) return value.length > 0
            return value !== undefined && value !== null && value !== ''
        }).length

        return {
            supported: extractedCount > 0,
            sourceType,
            message: extractedCount > 0 ? 'Đã đọc dữ liệu bảng giá. Vui lòng kiểm tra lại trước khi lưu.' : 'Không nhận diện được dữ liệu bảng giá từ file.',
            fields: result.fields,
            warnings: result.warnings,
            rawTextPreview: text.slice(0, 3000),
        }
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
                termProfile: true,

                lines: {
                    include: {
                        product: true,
                        receivingWarehouse: true,
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

                    include: {
                        lines: { include: { lot: true } },
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
        const inputHash = createHash('sha256')
            .update(JSON.stringify({ orderId: order.id, dto }))
            .digest('hex')
        const existed = await tx.purchasePricingRun.findFirst({
            where: {
                purchaseOrderId: order.id,
            },

            orderBy: {
                createdAt: 'desc',
            },
        })

        if (existed && existed.status !== PricingRunStatus.POSTED) {
            return existed
        }

        const qtyActualTotal = order.receipts.reduce(
            (sum: number, receipt: any) =>
                sum + receipt.lines.reduce((lineSum: number, line: any) => lineSum + Number(line.actualQty || 0), 0),
            0,
        )

        const qtyV15Total = order.receipts.reduce(
            (sum: number, receipt: any) =>
                sum + receipt.lines.reduce((lineSum: number, line: any) => lineSum + Number(line.v15Qty || 0), 0),
            0,
        )

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
                version: (existed?.version ?? 0) + 1,
                supersedesRunId: existed?.status === PricingRunStatus.POSTED ? existed.id : null,
                inputHash,
            },
        })
    }

    private validateStageFlow(order: any, stageType: PricingStageType) {
        if (order.status === PurchaseOrderStatus.CANCELLED) {
            throw new BadRequestException('PURCHASE_ORDER_CANCELLED')
        }

        if (stageType !== PricingStageType.ESTIMATE && !order.receipts.length) {
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

        if (stageType === PricingStageType.FINAL && hasFinal) {
            throw new BadRequestException('POSTED_PRICING_IMMUTABLE')
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
            await tx.purchasePricingPriceDay.deleteMany({
                where: {
                    stageId: existed.id,
                },
            })

            await tx.purchasePricingSheetRow.deleteMany({
                where: {
                    stageId: existed.id,
                },
            })

            await tx.purchasePricingStageCost.deleteMany({
                where: {
                    stageId: existed.id,
                },
            })

            await tx.purchasePricingStageLine.deleteMany({
                where: {
                    stageId: existed.id,
                },
            })

            await tx.purchasePricingStage.delete({
                where: {
                    id: existed.id,
                },
            })
        }

        const mops = Number(dto.mopsAvgUsdPerBbl ?? 0)
        const premium = Number(dto.premiumUsdPerBbl ?? order.termProfile?.premiumUsdPerBbl ?? 0)
        const specialTax = Number(dto.specialConsumptionTaxUsdPerBbl ?? 0)

        return tx.purchasePricingStage.create({
            data: {
                runId,
                stageType,

                mopsAvgUsdPerBbl: new Prisma.Decimal(mops),
                premiumUsdPerBbl: new Prisma.Decimal(premium),
                specialConsumptionTaxUsdPerBbl: new Prisma.Decimal(specialTax),
                unitUsdPerBbl: new Prisma.Decimal(this.round(mops + premium + specialTax, 3)),

                fxRateDate: this.toDateOnly(dto.fxRateDate),
                fxStage: dto.fxStage ?? FxStage.ESTIMATE,
                fxRate: dto.fxRate !== undefined && dto.fxRate !== null ? new Prisma.Decimal(dto.fxRate) : null,

                billBarrelQty: dto.billBarrelQty !== undefined && dto.billBarrelQty !== null ? new Prisma.Decimal(dto.billBarrelQty) : null,

                tankQtyLiter: dto.tankQtyLiter !== undefined && dto.tankQtyLiter !== null ? new Prisma.Decimal(dto.tankQtyLiter) : null,

                insuranceRate: dto.insuranceRate !== undefined && dto.insuranceRate !== null ? new Prisma.Decimal(dto.insuranceRate) : null,

                insuranceAmountVnd: dto.insuranceAmountVnd !== undefined && dto.insuranceAmountVnd !== null ? new Prisma.Decimal(dto.insuranceAmountVnd) : null,

                inspectionFeeVnd: dto.inspectionFeeVnd !== undefined && dto.inspectionFeeVnd !== null ? new Prisma.Decimal(dto.inspectionFeeVnd) : null,

                transportFeeVnd: dto.transportFeeVnd !== undefined && dto.transportFeeVnd !== null ? new Prisma.Decimal(dto.transportFeeVnd) : null,

                storageFeeVnd: dto.storageFeeVnd !== undefined && dto.storageFeeVnd !== null ? new Prisma.Decimal(dto.storageFeeVnd) : null,

                transportLossRate: dto.transportLossRate !== undefined && dto.transportLossRate !== null ? new Prisma.Decimal(dto.transportLossRate) : null,

                transportLossAmountVnd: dto.transportLossAmountVnd !== undefined && dto.transportLossAmountVnd !== null ? new Prisma.Decimal(dto.transportLossAmountVnd) : null,

                transportDeductionVnd: dto.transportDeductionVnd !== undefined && dto.transportDeductionVnd !== null ? new Prisma.Decimal(dto.transportDeductionVnd) : null,

                envTaxVndPerLiter: dto.envTaxVndPerLiter !== undefined && dto.envTaxVndPerLiter !== null ? new Prisma.Decimal(dto.envTaxVndPerLiter) : null,

                extraCostVndPerLiter: dto.extraCostVndPerLiter !== undefined && dto.extraCostVndPerLiter !== null ? new Prisma.Decimal(dto.extraCostVndPerLiter) : null,

                fundAdjustmentVndPerLiter: dto.fundAdjustmentVndPerLiter !== undefined && dto.fundAdjustmentVndPerLiter !== null ? new Prisma.Decimal(dto.fundAdjustmentVndPerLiter) : null,

                retailPriceVndPerLiter: dto.retailPriceVndPerLiter !== undefined && dto.retailPriceVndPerLiter !== null ? new Prisma.Decimal(dto.retailPriceVndPerLiter) : null,

                contractPaymentRate: dto.contractPaymentRate !== undefined && dto.contractPaymentRate !== null ? new Prisma.Decimal(dto.contractPaymentRate) : null,

                bankGuaranteeRate: dto.bankGuaranteeRate !== undefined && dto.bankGuaranteeRate !== null ? new Prisma.Decimal(dto.bankGuaranteeRate) : null,

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

            const receivedLines = order.receipts.flatMap((receipt: any) =>
                receipt.lines.filter((receiptLine: any) => receiptLine.purchaseOrderLineId === line.id),
            )
            const receivedActual = receivedLines.reduce(
                (sum: number, receiptLine: any) => sum + Number(receiptLine.actualQty ?? 0),
                0,
            )
            const receivedV15 = receivedLines.reduce(
                (sum: number, receiptLine: any) => sum + Number(receiptLine.v15Qty ?? 0),
                0,
            )
            const qtyActual = input.qtyActual ?? (receivedActual > 0 ? receivedActual : Number(line.orderedQty || 0))
            const qtyV15 = input.qtyV15 ?? (receivedV15 > 0 ? receivedV15 : Number(line.orderedQty || 0))

            await tx.purchasePricingStageLine.create({
                data: {
                    stageId,

                    purchaseOrderLineId: line.id,

                    productId: line.productId,

                    supplierLocationId: line.receivingWarehouseId,

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

    private round(value: number, digits = 3): number {
        const factor = 10 ** digits
        return Math.round((value + Number.EPSILON) * factor) / factor
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

        const unitUsdPerBbl = this.round(avgPlatts + premium + specialTax, 3)

        const billBarrelQty = this.toNumber(stage.billBarrelQty)
        const paymentAmountUsd = unitUsdPerBbl * billBarrelQty

        const fxRate = this.toNumber(stage.fxRate)

        const insuranceRate = this.toNumber(stage.insuranceRate)
        const inputInsuranceAmountVnd = stage.insuranceAmountVnd === null || stage.insuranceAmountVnd === undefined ? null : this.toNumber(stage.insuranceAmountVnd)
        const insuranceAmountVnd = inputInsuranceAmountVnd ?? paymentAmountUsd * fxRate * insuranceRate

        const inspectionFeeVnd = this.toNumber(stage.inspectionFeeVnd)
        const transportFeeVnd = this.toNumber(stage.transportFeeVnd)
        const storageFeeVnd = this.toNumber(stage.storageFeeVnd)

        const transportLossRate = this.toNumber(stage.transportLossRate)
        const inputTransportLossAmountVnd = stage.transportLossAmountVnd === null || stage.transportLossAmountVnd === undefined ? null : this.toNumber(stage.transportLossAmountVnd)
        const transportLossAmountVnd = inputTransportLossAmountVnd ?? paymentAmountUsd * fxRate * transportLossRate
        const transportDeductionVnd = this.toNumber(stage.transportDeductionVnd)

        const extraStageCosts = stage.costs.reduce((sum, x) => sum + this.toNumber(x.amountVnd), 0)

        const billTotalVnd =
            paymentAmountUsd * fxRate +
            insuranceAmountVnd +
            inspectionFeeVnd +
            transportFeeVnd +
            storageFeeVnd +
            transportLossAmountVnd +
            extraStageCosts -
            transportDeductionVnd

        const tankQtyLiter = this.toNumber(stage.tankQtyLiter)

        const tankUnitPriceVndPerLiter = tankQtyLiter > 0 ? billTotalVnd / tankQtyLiter : 0

        const envTaxVndPerLiter = this.toNumber(stage.envTaxVndPerLiter)
        const extraCostVndPerLiter = this.toNumber(stage.extraCostVndPerLiter)
        const fundAdjustmentVndPerLiter = this.toNumber(stage.fundAdjustmentVndPerLiter)
        const fundAdjustmentAmountVnd = fundAdjustmentVndPerLiter * tankQtyLiter

        const sellingUnitPriceVndPerLiter = tankUnitPriceVndPerLiter + envTaxVndPerLiter + extraCostVndPerLiter + fundAdjustmentVndPerLiter

        const temporaryAmountVnd = sellingUnitPriceVndPerLiter * tankQtyLiter
        const contractPaymentRate = this.toNumber(stage.contractPaymentRate)
        const contractPaymentAmountVnd = temporaryAmountVnd * contractPaymentRate / 100
        const bankGuaranteeRate = this.toNumber(stage.bankGuaranteeRate)
        const bankGuaranteeFeeVnd = temporaryAmountVnd * bankGuaranteeRate / 100

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
                transportDeductionVnd: new Prisma.Decimal(transportDeductionVnd),

                billTotalVnd: new Prisma.Decimal(billTotalVnd),
                tankUnitPriceVndPerLiter: new Prisma.Decimal(tankUnitPriceVndPerLiter),
                sellingUnitPriceVndPerLiter: new Prisma.Decimal(sellingUnitPriceVndPerLiter),
                temporaryAmountVnd: new Prisma.Decimal(temporaryAmountVnd),
                fundAdjustmentAmountVnd: new Prisma.Decimal(fundAdjustmentAmountVnd),
                contractPaymentAmountVnd: new Prisma.Decimal(contractPaymentAmountVnd),
                bankGuaranteeFeeVnd: new Prisma.Decimal(bankGuaranteeFeeVnd),
                discountVndPerLiter: new Prisma.Decimal(discountVndPerLiter),

                totalAmountVnd: new Prisma.Decimal(temporaryAmountVnd),
                unitVndPerLiter: new Prisma.Decimal(sellingUnitPriceVndPerLiter),
            },
        })
    }

    /**
     * Restates the cost of quantities that were already SOLD from this layer while the price
     * was still provisional (spec v1.2 §10, GĐ 8).
     *
     * Without this, finalising a TERM price would only fix stock still on hand and the margin
     * on everything already invoiced would stay wrong for good.
     *
     * The adjustment is booked as an append-only REVALUATION entry carrying the sales
     * delivery line, so profitability picks it up as extra cost of that exact sale. It does
     * NOT touch the layer balance: that value left the layer when the goods were issued.
     * Sign follows SALES_ISSUE — value leaving is negative, so a higher final price produces
     * a negative delta (more cost).
     */
    private async revalueIssuedPortion(
        tx: Prisma.TransactionClient,
        args: { costLayerId: string; finalUnitCost: Prisma.Decimal; runId: string },
    ) {
        const issues = await tx.costLayerEntry.findMany({
            where: {
                costLayerId: args.costLayerId,
                type: 'SALES_ISSUE',
                reversedBy: null,
            },
        })
        for (const issue of issues) {
            const qty = issue.actualQtyDelta.negated()
            if (!qty.greaterThan(0)) continue
            // What the sale was originally charged per unit.
            const chargedUnit = issue.valueDelta.negated().div(qty)
            const delta = qty.mul(args.finalUnitCost.minus(chargedUnit))
            if (delta.isZero()) continue

            const idempotencyKey = `pricing:${args.runId}:issue:${issue.id}:revalue`
            const existing = await tx.costLayerEntry.findUnique({ where: { idempotencyKey } })
            if (existing) continue

            await tx.costLayerEntry.create({
                data: {
                    costLayerId: args.costLayerId,
                    type: 'REVALUATION',
                    // A DB check allows one source link per entry: cite the sale, not the
                    // pricing line, so the report can attribute the adjustment.
                    salesDeliveryLineId: issue.salesDeliveryLineId,
                    valueDelta: delta.negated(),
                    idempotencyKey,
                    effectiveAt: new Date(),
                },
            })
        }
        return issues.length
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

        let createdCount = 0
        for (const receipt of order.receipts) {
            for (const receiptLine of receipt.lines ?? []) {
                if (!receiptLine.lot) continue
                const pricingLine = stage.lines.find(
                    (line) =>
                        line.productId === receiptLine.productId &&
                        (!line.purchaseOrderLineId || line.purchaseOrderLineId === receiptLine.purchaseOrderLineId),
                )
                if (!pricingLine) continue
                const qty = new Prisma.Decimal(receiptLine.actualQty)
                if (!qty.isPositive()) continue
                const unitCost = new Prisma.Decimal(pricingLine.unitVndPerLiter ?? 0)
                const totalCost = qty.mul(unitCost)
                const existing = await tx.inventoryCostLayer.findUnique({
                    where: {
                        inventoryLotId_ownerPartyId: {
                            inventoryLotId: receiptLine.lot.id,
                            ownerPartyId: receiptLine.ownerPartyId,
                        },
                    },
                })
                if (existing) {
                    const currentUnit = existing.remainingActualQty.isZero()
                        ? new Prisma.Decimal(0)
                        : existing.remainingValue.div(existing.remainingActualQty)
                    const valueDelta = existing.remainingActualQty.mul(unitCost.minus(currentUnit))
                    await tx.costLayerEntry.create({
                        data: {
                            costLayerId: existing.id,
                            type: 'REVALUATION',
                            valueDelta,
                            pricingStageLineId: pricingLine.id,
                            idempotencyKey: `pricing:${runId}:lot:${receiptLine.lot.id}:revalue`,
                            effectiveAt: new Date(),
                        },
                    })
                    await tx.inventoryCostLayer.update({
                        where: { id: existing.id },
                        data: {
                            remainingValue: existing.remainingValue.plus(valueDelta),
                            isProvisional: false,
                            version: { increment: 1 },
                        },
                    })
                    await this.revalueIssuedPortion(tx, {
                        costLayerId: existing.id,
                        finalUnitCost: unitCost,
                        runId,
                    })
                } else {
                    const layer = await tx.inventoryCostLayer.create({
                        data: {
                            inventoryLotId: receiptLine.lot.id,
                            ownerPartyId: receiptLine.ownerPartyId,
                            originalActualQty: qty,
                            remainingActualQty: qty,
                            remainingValue: totalCost,
                            currency: 'VND',
                            isProvisional: false,
                            openedAt: new Date(),
                        },
                    })
                    await tx.costLayerEntry.create({
                        data: {
                            costLayerId: layer.id,
                            type: 'FINALIZE',
                            actualQtyDelta: qty,
                            valueDelta: totalCost,
                            pricingStageLineId: pricingLine.id,
                            idempotencyKey: `pricing:${runId}:lot:${receiptLine.lot.id}:open`,
                            effectiveAt: layer.openedAt,
                        },
                    })
                }
                createdCount += 1
            }
        }
        if (!createdCount) {
            throw new BadRequestException('FINAL_PRICING_REQUIRES_POSTED_INVENTORY_LOTS')
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

                const premium = Number(dto.premiumUsdPerBbl ?? order.termProfile?.premiumUsdPerBbl ?? 0)
                const specialTax = Number(dto.specialConsumptionTaxUsdPerBbl ?? 0)

                await tx.purchasePricingStage.update({
                    where: {
                        id: stage.id,
                    },
                    data: {
                        mopsAvgUsdPerBbl: new Prisma.Decimal(avg),
                        premiumUsdPerBbl: new Prisma.Decimal(premium),
                        unitUsdPerBbl: new Prisma.Decimal(this.round(avg + premium + specialTax, 3)),
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
                        postedAt: new Date(),
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
            code: 'TRANSPORT_DEDUCTION',
            label: 'Trừ cước/chi quỹ',
            value: stage.transportDeductionVnd,
            unit: 'VND',
            rowType: PricingSheetRowType.COST,
            isInput: true,
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
            code: 'FUND_ADJUSTMENT_PER_LITER',
            label: 'Trích/chi quỹ',
            value: stage.fundAdjustmentVndPerLiter,
            unit: 'VND/lit',
            rowType: PricingSheetRowType.COST,
            isInput: true,
        })

        addRow({
            code: 'FUND_ADJUSTMENT_AMOUNT',
            label: 'Thành tiền trích/chi quỹ',
            value: stage.fundAdjustmentAmountVnd,
            unit: 'VND',
            formula: 'Trích/chi quỹ * Số lượng nhập',
            rowType: PricingSheetRowType.COST,
            isBold: true,
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

        addRow({
            code: 'INPUT_QTY',
            label: 'Số lượng nhập',
            value: stage.tankQtyLiter,
            unit: 'lit',
            rowType: PricingSheetRowType.INPUT,
            isInput: true,
            isBold: true,
        })

        addRow({
            code: 'CONTRACT_PAYMENT_RATE',
            label: 'Tỷ lệ thanh toán trước theo hợp đồng',
            value: stage.contractPaymentRate,
            unit: '%',
            rowType: PricingSheetRowType.INPUT,
            isInput: true,
        })

        addRow({
            code: 'CONTRACT_PAYMENT_AMOUNT',
            label: 'Giá trị thanh toán theo đơn hàng',
            value: stage.contractPaymentAmountVnd,
            unit: 'VND',
            formula: 'Thành tiền trước thuế VAT * tỷ lệ thanh toán',
            rowType: PricingSheetRowType.RESULT,
            isResult: true,
            isBold: true,
        })

        addRow({
            code: 'BANK_GUARANTEE_RATE',
            label: 'Tỷ lệ phí bảo lãnh ngân hàng',
            value: stage.bankGuaranteeRate,
            unit: '%',
            rowType: PricingSheetRowType.INPUT,
            isInput: true,
        })

        addRow({
            code: 'BANK_GUARANTEE_FEE',
            label: 'Phí bảo lãnh ngân hàng',
            value: stage.bankGuaranteeFeeVnd,
            unit: 'VND',
            formula: 'Thành tiền trước thuế VAT * tỷ lệ phí bảo lãnh',
            rowType: PricingSheetRowType.COST,
            isBold: true,
        })

        await tx.purchasePricingSheetRow.createMany({
            data: rows,
        })
    }

    async createBossSheet(orderId: string, dto: CalculateTermPricingDto) {
        return this.createStage(orderId, dto, PricingStageType.BOSS_SHEET)
    }
}
