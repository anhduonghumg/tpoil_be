import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PurchaseBizType, PricingStageType, TermOrderDocumentSourceType, TermOrderDocumentStatus } from '@prisma/client'
import { createHash } from 'crypto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { PrintTermOrderDocumentsDto } from './dto/print-term-order-documents.dto'

@Injectable()
export class PurchaseTermOrderDocumentsService {
    private readonly buyer = {
        name: 'CÔNG TY TNHH VT&TMXD THIÊN PHÚC',
        address: 'Số 09 - Triệu Quốc Đạt - Phường Hạc Thành - Tỉnh Thanh Hóa',
        phone: '0373.752971',
        fax: '0373.722038',
    }

    constructor(private readonly prisma: PrismaService) {}

    async generate(purchaseOrderId: string) {
        const order = await this.getOrder(purchaseOrderId)

        return this.prisma.$transaction(async (tx) => {
            await tx.purchaseTermOrderDocument.updateMany({
                where: {
                    purchaseOrderId,
                    status: TermOrderDocumentStatus.ACTIVE,
                },
                data: {
                    status: TermOrderDocumentStatus.SUPERSEDED,
                },
            })

            const snapshot = this.buildSnapshot(order)

            return tx.purchaseTermOrderDocument.create({
                data: {
                    ...snapshot.header,
                    lines: {
                        create: snapshot.lines,
                    },
                },
                include: {
                    lines: {
                        orderBy: {
                            createdAt: 'asc',
                        },
                    },
                },
            })
        })
    }

    async detail(purchaseOrderId: string) {
        const document = await this.prisma.purchaseTermOrderDocument.findFirst({
            where: {
                purchaseOrderId,
                status: TermOrderDocumentStatus.ACTIVE,
            },
            include: {
                lines: {
                    orderBy: {
                        createdAt: 'asc',
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        })

        if (!document) {
            throw new NotFoundException('TERM_ORDER_DOCUMENT_NOT_FOUND')
        }

        return this.toPrintDocument(document)
    }

    async printBatch(dto: PrintTermOrderDocumentsDto) {
        const ids = [...new Set(dto.ids || [])]

        if (!ids.length) {
            throw new BadRequestException('TERM_ORDER_DOCUMENT_IDS_REQUIRED')
        }

        if (ids.length > 100) {
            throw new BadRequestException('TERM_ORDER_DOCUMENT_PRINT_LIMIT_EXCEEDED')
        }

        const activeDocuments = await this.prisma.purchaseTermOrderDocument.findMany({
            where: {
                purchaseOrderId: {
                    in: ids,
                },
                status: TermOrderDocumentStatus.ACTIVE,
            },
            include: {
                lines: {
                    orderBy: {
                        createdAt: 'asc',
                    },
                },
            },
        })

        const byOrderId = new Map(activeDocuments.map((document) => [document.purchaseOrderId, document]))
        const skipped: Array<{ orderId: string; reason: string }> = []

        if (dto.autoGenerate) {
            for (const id of ids) {
                if (byOrderId.has(id)) continue

                try {
                    const created = await this.generate(id)
                    byOrderId.set(id, created)
                } catch (error: any) {
                    skipped.push({
                        orderId: id,
                        reason: error?.message || 'Không đủ dữ liệu sinh đơn đặt hàng',
                    })
                }
            }
        } else {
            for (const id of ids) {
                if (!byOrderId.has(id)) {
                    skipped.push({
                        orderId: id,
                        reason: 'Chưa sinh đơn đặt hàng',
                    })
                }
            }
        }

        return {
            items: ids.map((id) => byOrderId.get(id)).filter(Boolean).map((document) => this.toPrintDocument(document)),
            skipped,
        }
    }

    private async getOrder(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: {
                id,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                supplier: true,
                supplierLocation: true,
                contract: true,
                lines: {
                    include: {
                        product: true,
                    },
                    orderBy: {
                        createdAt: 'asc',
                    },
                },
                pricingRuns: {
                    include: {
                        stages: {
                            include: {
                                lines: {
                                    include: {
                                        product: true,
                                    },
                                    orderBy: {
                                        createdAt: 'asc',
                                    },
                                },
                                costs: true,
                            },
                        },
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                },
            },
        })

        if (!order) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        return order
    }

    private buildSnapshot(order: any) {
        const estimate = this.findEstimateStage(order)

        if (estimate) {
            return this.buildFromEstimate(order, estimate)
        }

        return this.buildDirect(order)
    }

    private findEstimateStage(order: any) {
        for (const run of order.pricingRuns || []) {
            const stage = (run.stages || []).find((item: any) => item.stageType === PricingStageType.ESTIMATE)
            if (stage) return stage
        }

        return null
    }

    private buildFromEstimate(order: any, stage: any) {
        const qty = this.toNumber(stage.tankQtyLiter) || (stage.lines || []).reduce((sum: number, line: any) => sum + this.toNumber(line.qtyV15 ?? line.qtyActual), 0)
        const totalAmount = this.toNumber(stage.totalAmountVnd ?? stage.temporaryAmountVnd)
        const amountBeforeVat = this.toNumber(stage.temporaryAmountVnd ?? stage.totalAmountVnd)
        const vatRate = this.getVatRate(order)
        const unitPrice = qty > 0 ? totalAmount / qty : 0

        const lines = this.buildEstimateLines(stage, qty, totalAmount, unitPrice, vatRate)

        return {
            header: this.buildHeader(order, {
                sourceType: TermOrderDocumentSourceType.ESTIMATE_PRICING,
                sourcePricingStageId: stage.id,
                totalQtyLiter: qty,
                unitPriceVndPerLiter: unitPrice,
                amountVnd: amountBeforeVat,
                vatRate,
                totalAmountVnd: totalAmount,
                sourceHash: this.hash({
                    stageId: stage.id,
                    totalAmount,
                    qty,
                    unitPrice,
                    updatedAt: stage.updatedAt,
                }),
                priceBasisNote: this.buildPriceBasisNote(stage),
            }),
            lines,
        }
    }

    private buildEstimateLines(stage: any, totalQty: number, totalAmount: number, unitPrice: number, vatRate: number) {
        const lines = stage.lines || []

        if (!lines.length) {
            return [
                {
                    productName: 'Hàng hóa TERM',
                    qtyLiter: new Prisma.Decimal(totalQty),
                    unitPriceVndPerLiter: new Prisma.Decimal(unitPrice),
                    amountVnd: new Prisma.Decimal(totalAmount),
                    vatRate: new Prisma.Decimal(vatRate),
                },
            ]
        }

        let assigned = 0

        return lines.map((line: any, index: number) => {
            const qty = this.toNumber(line.qtyV15 ?? line.qtyActual)
            const amount = index === lines.length - 1 ? totalAmount - assigned : qty * unitPrice
            assigned += amount

            return {
                productId: line.productId,
                productCode: line.product?.code ?? null,
                productName: line.product?.name ?? 'Hàng hóa TERM',
                qtyLiter: new Prisma.Decimal(qty),
                unitPriceVndPerLiter: new Prisma.Decimal(unitPrice),
                amountVnd: new Prisma.Decimal(amount),
                vatRate: new Prisma.Decimal(vatRate),
            }
        })
    }

    private buildDirect(order: any) {
        if (!order.lines?.length) {
            throw new BadRequestException('TERM_ORDER_LINES_REQUIRED')
        }

        const lines = order.lines.map((line: any) => {
            const qty = this.toNumber(line.orderedQty)
            const unitBeforeVat = this.toNumber(line.unitPrice)
            const vatRate = this.toNumber(line.taxRate)
            const unitPrice = unitBeforeVat * (1 + vatRate / 100)
            const amount = qty * unitPrice

            if (qty <= 0 || unitPrice <= 0) {
                throw new BadRequestException('TERM_DIRECT_ORDER_PRICE_REQUIRED')
            }

            return {
                productId: line.productId,
                productCode: line.product?.code ?? null,
                productName: line.product?.name ?? 'Hàng hóa TERM',
                qtyLiter: new Prisma.Decimal(qty),
                unitPriceVndPerLiter: new Prisma.Decimal(unitPrice),
                amountVnd: new Prisma.Decimal(amount),
                vatRate: new Prisma.Decimal(vatRate),
            }
        })

        const totalQty = lines.reduce((sum: number, line: any) => sum + this.toNumber(line.qtyLiter), 0)
        const totalAmount = lines.reduce((sum: number, line: any) => sum + this.toNumber(line.amountVnd), 0)
        const unitPrice = totalQty > 0 ? totalAmount / totalQty : 0
        const vatRate = this.getVatRate(order)

        return {
            header: this.buildHeader(order, {
                sourceType: TermOrderDocumentSourceType.DIRECT,
                sourcePricingStageId: null,
                totalQtyLiter: totalQty,
                unitPriceVndPerLiter: unitPrice,
                amountVnd: totalAmount,
                vatRate,
                totalAmountVnd: totalAmount,
                sourceHash: this.hash({
                    lines: order.lines.map((line: any) => ({
                        id: line.id,
                        qty: line.orderedQty,
                        price: line.unitPrice,
                        tax: line.taxRate,
                    })),
                    updatedAt: order.updatedAt,
                }),
                priceBasisNote: 'Giá thanh toán trên dựa trên giá nhập tại nhà máy',
            }),
            lines,
        }
    }

    private buildHeader(order: any, args: any) {
        const nextVersion = (order.termOrderDocuments?.length || 0) + 1

        return {
            purchaseOrderId: order.id,
            sourceType: args.sourceType,
            sourcePricingStageId: args.sourcePricingStageId,
            documentNo: this.buildDocumentNo(order),
            documentDate: this.toDateOnly(order.orderDate || new Date()),
            buyerName: this.buyer.name,
            buyerAddress: this.buyer.address,
            buyerPhone: this.buyer.phone,
            buyerFax: this.buyer.fax,
            supplierName: order.supplier?.name ?? '',
            supplierAddress: order.supplier?.billingAddress ?? order.supplier?.shippingAddress ?? null,
            supplierPhone: order.supplier?.contactPhone ?? null,
            contractNo: order.contractNo ?? order.contract?.code ?? null,
            appendixNo: null,
            deliveryTimeText: order.expectedDate ? `Dự kiến ngày ${this.formatShortDate(order.expectedDate)}` : null,
            deliveryLocation: order.deliveryLocation ?? order.supplierLocation?.name ?? null,
            paymentMethodText: order.paymentNote ?? 'Chuyển khoản',
            priceBasisNote: args.priceBasisNote,
            officialPriceNote: 'Đơn giá thanh toán sẽ điều chỉnh khi có giá chính thức của nhà máy',
            includedTaxNote: 'Đơn giá trên đã bao gồm thuế GTGT, thuế BVMT và quỹ bình ổn',
            totalQtyLiter: new Prisma.Decimal(args.totalQtyLiter),
            unitPriceVndPerLiter: new Prisma.Decimal(args.unitPriceVndPerLiter),
            amountVnd: new Prisma.Decimal(args.amountVnd),
            vatRate: new Prisma.Decimal(args.vatRate),
            totalAmountVnd: new Prisma.Decimal(args.totalAmountVnd),
            version: nextVersion,
            sourceHash: args.sourceHash,
            status: TermOrderDocumentStatus.ACTIVE,
        }
    }

    private buildDocumentNo(order: any) {
        const raw = String(order.orderNo || '').replace(/^TE/i, '').replace(/^-/, '')
        return raw ? `${raw}/ĐH-TP` : `ĐH-TP/${Date.now()}`
    }

    private buildPriceBasisNote(stage: any) {
        const parts: string[] = ['Giá thanh toán trên dựa trên giá nhập tại nhà máy']
        const transportFee = this.toNumber(stage.transportFeeVnd)
        const extraCost = this.toNumber(stage.extraCostVndPerLiter)
        const storageFee = this.toNumber(stage.storageFeeVnd)

        if (transportFee > 0) parts.push('đã bao gồm cước vận chuyển')
        else if (transportFee < 0) parts.push('không bao gồm cước vận chuyển')

        if (extraCost > 0) parts.push('đã bao gồm chi phí khác')
        if (storageFee > 0) parts.push('đã bao gồm phí thuê kho và hao hụt tồn chứa bơm rót')

        return parts.join(', ')
    }

    private getVatRate(order: any) {
        return this.toNumber(order.lines?.[0]?.taxRate)
    }

    private toPrintDocument(document: any) {
        return {
            id: document.id,
            purchaseOrderId: document.purchaseOrderId,
            sourceType: document.sourceType,
            sourcePricingStageId: document.sourcePricingStageId,
            documentNo: document.documentNo,
            documentDate: document.documentDate,
            buyerName: document.buyerName,
            buyerAddress: document.buyerAddress,
            buyerPhone: document.buyerPhone,
            buyerFax: document.buyerFax,
            supplierName: document.supplierName,
            supplierAddress: document.supplierAddress,
            supplierPhone: document.supplierPhone,
            contractNo: document.contractNo,
            appendixNo: document.appendixNo,
            deliveryTimeText: document.deliveryTimeText,
            deliveryLocation: document.deliveryLocation,
            paymentMethodText: document.paymentMethodText,
            priceBasisNote: document.priceBasisNote,
            officialPriceNote: document.officialPriceNote,
            includedTaxNote: document.includedTaxNote,
            totalQtyLiter: this.toNumber(document.totalQtyLiter),
            unitPriceVndPerLiter: this.toNumber(document.unitPriceVndPerLiter),
            amountVnd: this.toNumber(document.amountVnd),
            vatRate: this.toNumber(document.vatRate),
            totalAmountVnd: this.toNumber(document.totalAmountVnd),
            status: document.status,
            version: document.version,
            lines: (document.lines || []).map((line: any) => ({
                id: line.id,
                productId: line.productId,
                productCode: line.productCode,
                productName: line.productName,
                qtyLiter: this.toNumber(line.qtyLiter),
                unitPriceVndPerLiter: this.toNumber(line.unitPriceVndPerLiter),
                amountVnd: this.toNumber(line.amountVnd),
                vatRate: this.toNumber(line.vatRate),
                note: line.note,
            })),
        }
    }

    private toNumber(value: any) {
        if (value === null || value === undefined) return 0
        const n = Number(value)
        return Number.isFinite(n) ? n : 0
    }

    private hash(value: unknown) {
        return createHash('sha256').update(JSON.stringify(value)).digest('hex')
    }

    private toDateOnly(value: Date) {
        return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
    }

    private formatShortDate(value: Date) {
        const day = String(value.getDate()).padStart(2, '0')
        const month = String(value.getMonth() + 1).padStart(2, '0')
        return `${day}/${month}`
    }
}
