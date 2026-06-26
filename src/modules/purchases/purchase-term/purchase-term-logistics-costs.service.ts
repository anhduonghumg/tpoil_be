import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PurchaseBizType, TermLogisticsCostStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateTermLogisticsCostDto, TermLogisticsCostLineDto, UpdateTermLogisticsCostDto } from './dto/term-logistics-cost.dto'
import { PurchaseTermMapper } from './purchase-term.mapper'

@Injectable()
export class PurchaseTermLogisticsCostsService {
    constructor(private readonly prisma: PrismaService) {}

    private readonly include = {
        shipment: true,
        vendor: true,
        lines: {
            orderBy: {
                sortOrder: 'asc',
            },
        },
    } satisfies Prisma.TermLogisticsCostInclude

    private toDateOnly(value?: string | Date | null): Date | null | undefined {
        if (value === undefined) return undefined
        if (value === null) return null
        if (value instanceof Date) return value
        return new Date(`${value}T00:00:00.000Z`)
    }

    private normalizeCurrency(currency?: string | null): string {
        return (currency?.trim() || 'VND').toUpperCase()
    }

    private decimal(value: number | Prisma.Decimal): Prisma.Decimal {
        return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value)
    }

    private async ensureTermOrder(purchaseOrderId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
        const order = await tx.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            select: {
                id: true,
                bizType: true,
            },
        })

        if (!order || order.bizType !== PurchaseBizType.TERM) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        return order
    }

    private async ensureShipment(purchaseOrderId: string, shipmentId?: string | null, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
        if (!shipmentId) return

        const shipment = await tx.termShipment.findFirst({
            where: {
                id: shipmentId,
                purchaseOrderId,
            },
            select: {
                id: true,
            },
        })

        if (!shipment) {
            throw new BadRequestException('TERM_SHIPMENT_NOT_FOUND')
        }
    }

    private async ensureLineRefs(purchaseOrderId: string, lines: TermLogisticsCostLineDto[], tx: Prisma.TransactionClient | PrismaService = this.prisma) {
        const purchaseOrderLineIds = [...new Set(lines.map((x) => x.purchaseOrderLineId).filter(Boolean))] as string[]
        const goodsReceiptIds = [...new Set(lines.map((x) => x.goodsReceiptId).filter(Boolean))] as string[]

        if (purchaseOrderLineIds.length) {
            const count = await tx.purchaseOrderLine.count({
                where: {
                    id: { in: purchaseOrderLineIds },
                    purchaseOrderId,
                },
            })

            if (count !== purchaseOrderLineIds.length) {
                throw new BadRequestException('TERM_LOGISTICS_COST_ORDER_LINE_INVALID')
            }
        }

        if (goodsReceiptIds.length) {
            const count = await tx.goodsReceipt.count({
                where: {
                    id: { in: goodsReceiptIds },
                    purchaseOrderId,
                },
            })

            if (count !== goodsReceiptIds.length) {
                throw new BadRequestException('TERM_LOGISTICS_COST_RECEIPT_INVALID')
            }
        }
    }

    private buildLineData(costId: string, dtoLines: TermLogisticsCostLineDto[], currency: string, fxRate?: number | null) {
        if (!dtoLines.length) {
            throw new BadRequestException('TERM_LOGISTICS_COST_LINES_REQUIRED')
        }

        if (currency !== 'VND' && (!fxRate || Number(fxRate) <= 0)) {
            throw new BadRequestException('FX_RATE_REQUIRED_FOR_FOREIGN_CURRENCY')
        }

        let totalBeforeVat = new Prisma.Decimal(0)
        let totalVat = new Prisma.Decimal(0)

        const data = dtoLines.map((line, index) => {
            const amountBeforeVat = this.decimal(line.amountBeforeVat)
            const vatRate = this.decimal(line.vatRate ?? 0)
            const vatAmount = amountBeforeVat.mul(vatRate).div(100)
            const amountAfterVat = amountBeforeVat.plus(vatAmount)
            const amountVndBeforeVat = currency === 'VND' ? amountBeforeVat : amountBeforeVat.mul(fxRate!)
            const vatVnd = currency === 'VND' ? vatAmount : vatAmount.mul(fxRate!)

            totalBeforeVat = totalBeforeVat.plus(amountVndBeforeVat)
            totalVat = totalVat.plus(vatVnd)

            return {
                logisticsCostId: costId,
                costType: line.costType,
                productId: line.productId ?? null,
                purchaseOrderLineId: line.purchaseOrderLineId ?? null,
                goodsReceiptId: line.goodsReceiptId ?? null,
                allocationBasis: line.allocationBasis,
                amountBeforeVat,
                vatRate,
                vatAmount,
                amountAfterVat,
                amountVndBeforeVat,
                isCapitalizedToCost: line.isCapitalizedToCost ?? true,
                note: line.note?.trim() || null,
                sortOrder: line.sortOrder ?? index + 1,
            }
        })

        return {
            data,
            totalBeforeVat,
            totalVat,
            totalAfterVat: totalBeforeVat.plus(totalVat),
        }
    }

    async list(purchaseOrderId: string) {
        await this.ensureTermOrder(purchaseOrderId)

        const costs = await this.prisma.termLogisticsCost.findMany({
            where: { purchaseOrderId },
            include: this.include,
            orderBy: { createdAt: 'desc' },
        })

        return costs.map((x) => PurchaseTermMapper.toLogisticsCost(x))
    }

    async findById(purchaseOrderId: string, costId: string) {
        await this.ensureTermOrder(purchaseOrderId)

        const cost = await this.prisma.termLogisticsCost.findFirst({
            where: {
                id: costId,
                purchaseOrderId,
            },
            include: this.include,
        })

        if (!cost) {
            throw new NotFoundException('TERM_LOGISTICS_COST_NOT_FOUND')
        }

        return PurchaseTermMapper.toLogisticsCost(cost)
    }

    async create(purchaseOrderId: string, dto: CreateTermLogisticsCostDto) {
        const currency = this.normalizeCurrency(dto.currency)

        return this.prisma.$transaction(async (tx) => {
            await this.ensureTermOrder(purchaseOrderId, tx)
            await this.ensureShipment(purchaseOrderId, dto.shipmentId, tx)
            await this.ensureLineRefs(purchaseOrderId, dto.lines, tx)

            const cost = await tx.termLogisticsCost.create({
                data: {
                    purchaseOrderId,
                    shipmentId: dto.shipmentId ?? null,
                    vendorCustomerId: dto.vendorCustomerId ?? null,
                    documentNo: dto.documentNo?.trim() || null,
                    documentDate: this.toDateOnly(dto.documentDate),
                    currency,
                    fxRate: dto.fxRate !== undefined && dto.fxRate !== null ? new Prisma.Decimal(dto.fxRate) : null,
                    note: dto.note?.trim() || null,
                },
            })

            const lines = this.buildLineData(cost.id, dto.lines, currency, dto.fxRate)

            await tx.termLogisticsCostLine.createMany({
                data: lines.data,
            })

            await tx.termLogisticsCost.update({
                where: { id: cost.id },
                data: {
                    totalBeforeVat: lines.totalBeforeVat,
                    totalVat: lines.totalVat,
                    totalAfterVat: lines.totalAfterVat,
                },
            })

            const created = await tx.termLogisticsCost.findUniqueOrThrow({
                where: { id: cost.id },
                include: this.include,
            })

            return PurchaseTermMapper.toLogisticsCost(created)
        })
    }

    async update(purchaseOrderId: string, costId: string, dto: UpdateTermLogisticsCostDto) {
        return this.prisma.$transaction(async (tx) => {
            await this.ensureTermOrder(purchaseOrderId, tx)

            const current = await tx.termLogisticsCost.findFirst({
                where: {
                    id: costId,
                    purchaseOrderId,
                },
                include: {
                    lines: true,
                },
            })

            if (!current) {
                throw new NotFoundException('TERM_LOGISTICS_COST_NOT_FOUND')
            }

            if (current.status === TermLogisticsCostStatus.POSTED) {
                throw new BadRequestException('TERM_LOGISTICS_COST_POSTED_NOT_EDITABLE')
            }

            await this.ensureShipment(purchaseOrderId, dto.shipmentId, tx)

            const currency = this.normalizeCurrency(dto.currency ?? current.currency)
            const fxRate = dto.fxRate !== undefined ? dto.fxRate : current.fxRate ? Number(current.fxRate) : null
            const nextLines =
                dto.lines ??
                current.lines.map((line) => ({
                    costType: line.costType,
                    productId: line.productId,
                    purchaseOrderLineId: line.purchaseOrderLineId,
                    goodsReceiptId: line.goodsReceiptId,
                    allocationBasis: line.allocationBasis,
                    amountBeforeVat: Number(line.amountBeforeVat),
                    vatRate: Number(line.vatRate),
                    isCapitalizedToCost: line.isCapitalizedToCost,
                    note: line.note ?? undefined,
                    sortOrder: line.sortOrder,
                }))

            await this.ensureLineRefs(purchaseOrderId, nextLines, tx)

            await tx.termLogisticsCostLine.deleteMany({
                where: { logisticsCostId: costId },
            })

            const lines = this.buildLineData(costId, nextLines, currency, fxRate)

            await tx.termLogisticsCostLine.createMany({
                data: lines.data,
            })

            await tx.termLogisticsCost.update({
                where: { id: costId },
                data: {
                    shipmentId: dto.shipmentId !== undefined ? dto.shipmentId : undefined,
                    vendorCustomerId: dto.vendorCustomerId !== undefined ? dto.vendorCustomerId : undefined,
                    documentNo: dto.documentNo !== undefined ? dto.documentNo?.trim() || null : undefined,
                    documentDate: this.toDateOnly(dto.documentDate),
                    currency,
                    fxRate: fxRate !== null && fxRate !== undefined ? new Prisma.Decimal(fxRate) : null,
                    totalBeforeVat: lines.totalBeforeVat,
                    totalVat: lines.totalVat,
                    totalAfterVat: lines.totalAfterVat,
                    note: dto.note !== undefined ? dto.note?.trim() || null : undefined,
                },
            })

            const updated = await tx.termLogisticsCost.findUniqueOrThrow({
                where: { id: costId },
                include: this.include,
            })

            return PurchaseTermMapper.toLogisticsCost(updated)
        })
    }

    async remove(purchaseOrderId: string, costId: string) {
        await this.ensureTermOrder(purchaseOrderId)
        const cost = await this.prisma.termLogisticsCost.findFirst({
            where: {
                id: costId,
                purchaseOrderId,
            },
        })

        if (!cost) {
            throw new NotFoundException('TERM_LOGISTICS_COST_NOT_FOUND')
        }

        if (cost.status === TermLogisticsCostStatus.POSTED) {
            throw new BadRequestException('TERM_LOGISTICS_COST_POSTED_NOT_DELETABLE')
        }

        await this.prisma.termLogisticsCost.delete({
            where: { id: costId },
        })

        return { deleted: true }
    }

    async confirm(purchaseOrderId: string, costId: string) {
        await this.ensureTermOrder(purchaseOrderId)

        const current = await this.prisma.termLogisticsCost.findFirst({
            where: {
                id: costId,
                purchaseOrderId,
            },
            include: {
                lines: true,
            },
        })

        if (!current) {
            throw new NotFoundException('TERM_LOGISTICS_COST_NOT_FOUND')
        }

        if (current.status !== TermLogisticsCostStatus.DRAFT) {
            throw new BadRequestException('TERM_LOGISTICS_COST_NOT_IN_DRAFT')
        }

        if (!current.lines.length) {
            throw new BadRequestException('TERM_LOGISTICS_COST_LINES_REQUIRED')
        }

        await this.prisma.termLogisticsCost.update({
            where: { id: costId },
            data: { status: TermLogisticsCostStatus.CONFIRMED },
        })

        return this.findById(purchaseOrderId, costId)
    }

    async void(purchaseOrderId: string, costId: string) {
        await this.ensureTermOrder(purchaseOrderId)

        const current = await this.prisma.termLogisticsCost.findFirst({
            where: {
                id: costId,
                purchaseOrderId,
            },
        })

        if (!current) {
            throw new NotFoundException('TERM_LOGISTICS_COST_NOT_FOUND')
        }

        if (current.status === TermLogisticsCostStatus.POSTED) {
            throw new BadRequestException('TERM_LOGISTICS_COST_POSTED_NOT_VOIDABLE')
        }

        await this.prisma.termLogisticsCost.update({
            where: { id: costId },
            data: { status: TermLogisticsCostStatus.VOID },
        })

        return this.findById(purchaseOrderId, costId)
    }
}
