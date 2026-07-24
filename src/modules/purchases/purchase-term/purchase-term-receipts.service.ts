import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { GoodsReceiptStatus, PricingRunStatus, Prisma, PurchaseBizType, PurchaseOrderStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { UploadService } from 'src/modules/uploads/uploads.service'
import { CreateTermGoodsReceiptDto } from './dto/create-term-goods-receipt.dto'
import { UpdateTermGoodsReceiptDto } from './dto/update-term-goods-receipt.dto'
import pdf = require('pdf-parse')
import Tesseract = require('tesseract.js')
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'

type TermReceiptDocumentTemplate = 'TEMPLATE_1' | 'TEMPLATE_2'

@Injectable()
export class PurchaseTermReceiptsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly uploadService: UploadService,
        private readonly receiptPosting: GoodsReceiptPostingService,
    ) {}

    private toDateOnly(value?: string | Date | null): Date | undefined {
        if (!value) return undefined
        if (value instanceof Date) return value
        return new Date(`${value}T00:00:00.000Z`)
    }

    private toNumber(value: any): number | undefined {
        if (value === null || value === undefined) return undefined
        const num = Number(value)
        return Number.isFinite(num) ? num : undefined
    }

    private async generateReceiptNo(tx: Prisma.TransactionClient): Promise<string> {
        const now = new Date()
        const y = now.getFullYear()
        const m = String(now.getMonth() + 1).padStart(2, '0')
        const prefix = `GRTERM${y}${m}`

        const count = await tx.goodsReceipt.count({
            where: {
                receiptNo: {
                    startsWith: prefix,
                },
            },
        })

        return `${prefix}-${String(count + 1).padStart(4, '0')}`
    }

    private buildTermQuantityFields(dto: Partial<CreateTermGoodsReceiptDto>, fallbackBillQty?: Prisma.Decimal | number | null) {
        const tankQty = Number(dto.tankQty ?? dto.qty ?? 0)
        const billQty = Number(dto.billQty ?? fallbackBillQty ?? tankQty)
        const temporaryWithdrawQty = Number(dto.temporaryWithdrawQty ?? dto.standardQtyV15 ?? tankQty)
        const billToTankLossQty = Number(dto.billToTankLossQty ?? Math.max(billQty - tankQty, 0))

        return {
            billQty,
            tankQty,
            temporaryWithdrawQty,
            billToTankLossQty,
        }
    }

    private normalizeReceiptTemplate(value?: string | null): TermReceiptDocumentTemplate | null {
        if (value === 'TEMPLATE_1' || value === 'TEMPLATE_2') return value
        return null
    }

    private assertSupportedFile(file: Express.Multer.File) {
        if (!file) throw new BadRequestException('TERM_RECEIPT_DOCUMENT_FILE_REQUIRED')
        const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
        if (!allowed.includes(file.mimetype)) {
            throw new BadRequestException('TERM_RECEIPT_DOCUMENT_FILE_TYPE_NOT_ALLOWED')
        }
    }

    private async extractDocumentText(file: Express.Multer.File) {
        this.assertSupportedFile(file)

        if (file.mimetype === 'application/pdf') {
            const parsed = await pdf(file.buffer)
            return parsed.text || ''
        }

        const result = await Tesseract.recognize(file.buffer, 'vie+eng', {
            cachePath: '.cache/tesseract',
        } as any)

        return result.data.text || ''
    }

    private normalizeOcrText(value: string) {
        return value
            .replace(/\r/g, '\n')
            .replace(/[|]/g, ' ')
            .replace(/[，]/g, ',')
            .replace(/[–—]/g, '-')
    }

    private parseFlexibleNumber(value?: string | null): number | undefined {
        if (!value) return undefined
        const cleaned = value.replace(/[^\d,.]/g, '').trim()
        if (!cleaned) return undefined

        const hasComma = cleaned.includes(',')
        const hasDot = cleaned.includes('.')
        let normalized = cleaned

        if (hasComma && hasDot) normalized = cleaned.replace(/\./g, '').replace(',', '.')
        else if (hasComma) normalized = cleaned.replace(/\./g, '').replace(',', '.')
        else if (hasDot) {
            const parts = cleaned.split('.')
            normalized = parts.length > 2 || parts[parts.length - 1]?.length === 3 ? cleaned.replace(/\./g, '') : cleaned
        }

        const numberValue = Number(normalized)
        return Number.isFinite(numberValue) ? numberValue : undefined
    }

    private extractNumberAfter(text: string, pattern: RegExp): number | undefined {
        const match = text.match(pattern)
        return this.parseFlexibleNumber(match?.[1])
    }

    private extractDecimalCandidates(text: string) {
        const matches = text.match(/\d{1,3}(?:\.\d{3})*,\d{3}/g) ?? []
        return matches.map((item) => this.parseFlexibleNumber(item)).filter((item): item is number => item !== undefined)
    }

    private parseTemplate1(text: string) {
        const normalized = this.normalizeOcrText(text)
        let actualM3 =
            this.extractNumberAfter(normalized, /M3\s*th[ưư]c\s*t[ếe]\s*[:\s]*([\d.,]+)/i) ??
            this.extractNumberAfter(normalized, /M3\s*thuc\s*te\s*[:\s]*([\d.,]+)/i)
        let v15M3 =
            this.extractNumberAfter(normalized, /M3\s*\(?t[ạa]i\s*15[°\s]*C\)?\s*[:\s]*([\d.,]+)/i) ??
            this.extractNumberAfter(normalized, /M3\s*\(?tai\s*15[°\s]*C\)?\s*[:\s]*([\d.,]+)/i)

        if (actualM3 === undefined || v15M3 === undefined) {
            const tableStart = normalized.search(/Bbls|th[uù]ng|M3\s*\(?t/i)
            const tableText = tableStart >= 0 ? normalized.slice(tableStart, tableStart + 1200) : normalized
            const candidates = this.extractDecimalCandidates(tableText).filter((item) => item > 100)
            if (candidates.length >= 4) {
                v15M3 = v15M3 ?? candidates[1]
                actualM3 = actualM3 ?? candidates[3]
            }
        }

        const tankQty = actualM3 !== undefined ? Math.round(actualM3 * 1000) : undefined
        const temporaryWithdrawQty = v15M3 !== undefined ? Math.round(v15M3 * 1000) : tankQty
        const billQty = tankQty

        return {
            billQty,
            tankQty,
            temporaryWithdrawQty,
            billToTankLossQty: billQty !== undefined && tankQty !== undefined ? Math.max(billQty - tankQty, 0) : undefined,
        }
    }

    private parseTemplate2(text: string) {
        const normalized = this.normalizeOcrText(text)
        const actualLiter =
            this.extractNumberAfter(normalized, /nhi[ệe]t\s*đ[ộo]\s*th[ựu]c\s*t[ếe]\s*[:\s]*([\d.,]+)/i) ??
            this.extractNumberAfter(normalized, /nhiet\s*do\s*thuc\s*te\s*[:\s]*([\d.,]+)/i)
        const v15Liter =
            this.extractNumberAfter(normalized, /15\s*[°o]?\s*C\s*[:\s]*([\d.,]+)/i) ??
            this.extractNumberAfter(normalized, /15C\s*[:\s]*([\d.,]+)/i)

        const billQty = actualLiter
        const tankQty = actualLiter
        const temporaryWithdrawQty = v15Liter ?? actualLiter

        return {
            billQty,
            tankQty,
            temporaryWithdrawQty,
            billToTankLossQty: billQty !== undefined && tankQty !== undefined ? Math.max(billQty - tankQty, 0) : undefined,
        }
    }

    async importReceiptDocumentPreview(file: Express.Multer.File, template: string) {
        const normalizedTemplate = this.normalizeReceiptTemplate(template)
        if (!normalizedTemplate) throw new BadRequestException('TERM_RECEIPT_DOCUMENT_TEMPLATE_REQUIRED')

        const text = await this.extractDocumentText(file)
        const fields = normalizedTemplate === 'TEMPLATE_1' ? this.parseTemplate1(text) : this.parseTemplate2(text)

        const warnings: string[] = []
        if (!fields.billQty) warnings.push('Không đọc được số lượng hàng trên bill')
        if (!fields.tankQty) warnings.push('Không đọc được số lượng hàng lên bồn kho')
        if (!fields.temporaryWithdrawQty) warnings.push('Không đọc được số lượng hàng được rút tạm tính')

        return {
            template: normalizedTemplate,
            fields,
            warnings,
            rawText: text.slice(0, 4000),
        }
    }

    private receiptInclude = Prisma.validator<Prisma.GoodsReceiptInclude>()({
        supplier: true,
        warehouse: true,
        purchaseOrder: true,
        lines: {
            orderBy: { lineNo: 'asc' },
            include: {
                product: true,
                purchaseOrderLine: {
                    include: {
                        product: true,
                        receivingWarehouse: true,
                    },
                },
            },
        },
    })

    private mapReceipt(receipt: any) {
        const line = receipt.lines?.[0] ?? null
        const purchaseOrderLine = line?.purchaseOrderLine
            ? {
                  ...line.purchaseOrderLine,
                  supplierLocationId: line.purchaseOrderLine.receivingWarehouseId,
                  supplierLocation: line.purchaseOrderLine.receivingWarehouse,
              }
            : null
        return {
            ...receipt,
            supplierLocationId: receipt.warehouseId,
            supplierLocation: receipt.warehouse,
            purchaseOrderLineId: line?.purchaseOrderLineId ?? null,
            purchaseOrderLine,
            productId: line?.productId ?? null,
            product: line?.product ?? null,
            qty: line?.actualQty ?? null,
            standardQtyV15: line?.v15Qty ?? null,
            tempC: line?.temperatureC ?? null,
            density: line?.density ?? null,
            billQty: line?.billQty ?? null,
            tankQty: line?.tankQty ?? null,
            temporaryWithdrawQty: line?.temporaryWithdrawQty ?? null,
            billToTankLossQty: line?.billToTankLossQty ?? null,
        }
    }

    async create(orderId: string, dto: CreateTermGoodsReceiptDto, file?: Express.Multer.File) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: {
                id: orderId,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                lines: {
                    include: {
                        product: true,
                        receivingWarehouse: true,
                    },
                },
            },
        })

        if (!order) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        if (order.status !== PurchaseOrderStatus.APPROVED && order.status !== PurchaseOrderStatus.IN_PROGRESS) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_NOT_READY_FOR_RECEIPT')
        }

        const line = order.lines.find((x) => x.id === dto.purchaseOrderLineId)

        if (!line) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINE_NOT_FOUND')
        }

        if (dto.productId !== line.productId) {
            throw new BadRequestException('RECEIPT_PRODUCT_NOT_MATCH_ORDER_LINE')
        }

        const supplierLocationId = dto.supplierLocationId || line.receivingWarehouseId

        if (!supplierLocationId) {
            throw new BadRequestException('SUPPLIER_LOCATION_REQUIRED')
        }

        if (line.receivingWarehouseId && supplierLocationId !== line.receivingWarehouseId) {
            throw new BadRequestException('RECEIPT_LOCATION_NOT_MATCH_ORDER_LINE')
        }

        const termQty = this.buildTermQuantityFields(dto, line.orderedQty)

        if (termQty.tankQty <= 0) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_INVALID_QTY')
        }

        if (file) this.assertSupportedFile(file)
        const sourceFile = file ? this.uploadService.saveLocal(file, 'term-receipts') : null

        const receipt = await this.prisma.$transaction(async (tx) => {
            const receiptNo = await this.generateReceiptNo(tx)
            const warehouse = await tx.warehouse.findUnique({
                where: { id: supplierLocationId },
                select: { legalEntity: { select: { partyId: true } } },
            })
            if (!warehouse) throw new BadRequestException('SUPPLIER_LOCATION_NOT_FOUND')

            return tx.goodsReceipt.create({
                data: {
                    receiptNo,
                    supplierCustomerId: order.supplierCustomerId,
                    warehouseId: supplierLocationId,
                    receiptDate: this.toDateOnly(dto.receiptDate)!,
                    receiptDocumentTemplate: this.normalizeReceiptTemplate(dto.receiptDocumentTemplate),
                    sourceFileName: sourceFile?.originalName ?? null,
                    sourceFileUrl: sourceFile?.url ?? null,
                    sourceFileMimeType: sourceFile?.mimeType ?? null,
                    sourceFileSizeBytes: sourceFile?.sizeBytes ?? null,
                    sourceFileChecksum: sourceFile?.checksum ?? null,
                    vehicleId: dto.vehicleId ?? null,
                    driverId: dto.driverId ?? null,
                    shippingFee: dto.shippingFee !== undefined && dto.shippingFee !== null ? new Prisma.Decimal(dto.shippingFee) : new Prisma.Decimal(0),
                    note: dto.note?.trim() || null,
                    status: GoodsReceiptStatus.DRAFT,
                    purchaseOrderId: order.id,
                    lines: {
                        create: {
                            lineNo: 1,
                            purchaseOrderLineId: line.id,
                            productId: line.productId,
                            ownerPartyId: warehouse.legalEntity.partyId,
                            actualQty: new Prisma.Decimal(termQty.tankQty),
                            v15Qty: new Prisma.Decimal(termQty.temporaryWithdrawQty),
                            temperatureC:
                                dto.tempC !== undefined && dto.tempC !== null ? new Prisma.Decimal(dto.tempC) : null,
                            density:
                                dto.density !== undefined && dto.density !== null ? new Prisma.Decimal(dto.density) : null,
                            billQty: new Prisma.Decimal(termQty.billQty),
                            tankQty: new Prisma.Decimal(termQty.tankQty),
                            temporaryWithdrawQty: new Prisma.Decimal(termQty.temporaryWithdrawQty),
                            billToTankLossQty: new Prisma.Decimal(termQty.billToTankLossQty),
                        },
                    },
                },
                include: this.receiptInclude,
            })
        })

        return this.mapReceipt(receipt)
    }

    async listByOrder(orderId: string) {
        const receipts = await this.prisma.goodsReceipt.findMany({
            where: {
                purchaseOrderId: orderId,
                purchaseOrder: {
                    bizType: PurchaseBizType.TERM,
                },
            },
            include: this.receiptInclude,
            orderBy: {
                createdAt: 'desc',
            },
        })
        return receipts.map((receipt) => this.mapReceipt(receipt))
    }

    async findById(id: string) {
        const receipt = await this.prisma.goodsReceipt.findFirst({
            where: {
                id,
                purchaseOrder: {
                    bizType: PurchaseBizType.TERM,
                },
            },
            include: this.receiptInclude,
        })

        if (!receipt) {
            throw new NotFoundException('TERM_GOODS_RECEIPT_NOT_FOUND')
        }

        return this.mapReceipt(receipt)
    }

    async update(id: string, dto: UpdateTermGoodsReceiptDto) {
        const current = await this.findById(id)

        if (current.status !== GoodsReceiptStatus.DRAFT) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_NOT_IN_DRAFT')
        }

        const usedInPostedRun = await this.isUsedInPostedPricing(id)

        if (usedInPostedRun) {
            throw new BadRequestException('RECEIPT_USED_IN_POSTED_PRICING_NOT_EDITABLE')
        }

        const line = current.purchaseOrderLine

        if (!line) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINE_NOT_FOUND')
        }

        const supplierLocationId = dto.supplierLocationId || current.supplierLocationId || line.supplierLocationId

        if (!supplierLocationId) {
            throw new BadRequestException('SUPPLIER_LOCATION_REQUIRED')
        }

        if (line.receivingWarehouseId && supplierLocationId !== line.receivingWarehouseId) {
            throw new BadRequestException('RECEIPT_LOCATION_NOT_MATCH_ORDER_LINE')
        }

        if (dto.productId && dto.productId !== line.productId) {
            throw new BadRequestException('RECEIPT_PRODUCT_NOT_MATCH_ORDER_LINE')
        }

        const termQty = this.buildTermQuantityFields(
            {
                qty: dto.qty ?? this.toNumber(current.qty),
                standardQtyV15: dto.standardQtyV15 ?? this.toNumber(current.standardQtyV15),
                billQty: dto.billQty ?? this.toNumber(current.billQty ?? current.purchaseOrderLine?.orderedQty),
                tankQty: dto.tankQty ?? this.toNumber(current.tankQty ?? current.qty),
                temporaryWithdrawQty: dto.temporaryWithdrawQty ?? this.toNumber(current.temporaryWithdrawQty ?? current.standardQtyV15),
                billToTankLossQty: dto.billToTankLossQty ?? this.toNumber(current.billToTankLossQty),
            },
            current.purchaseOrderLine?.orderedQty,
        )

        if (termQty.tankQty <= 0) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_INVALID_QTY')
        }

        const receiptLineId = current.lines?.[0]?.id
        if (!receiptLineId) throw new BadRequestException('TERM_GOODS_RECEIPT_LINE_NOT_FOUND')

        await this.prisma.$transaction(async (tx) => {
            const warehouse = await tx.warehouse.findUnique({
                where: { id: supplierLocationId },
                select: { legalEntity: { select: { partyId: true } } },
            })
            if (!warehouse) throw new BadRequestException('SUPPLIER_LOCATION_NOT_FOUND')

            await tx.goodsReceipt.update({
                where: { id },
                data: {
                    warehouseId: supplierLocationId,
                    receiptDate: dto.receiptDate !== undefined ? this.toDateOnly(dto.receiptDate) : undefined,
                    receiptDocumentTemplate:
                        dto.receiptDocumentTemplate !== undefined
                            ? this.normalizeReceiptTemplate(dto.receiptDocumentTemplate)
                            : undefined,
                    vehicleId: dto.vehicleId !== undefined ? dto.vehicleId : undefined,
                    driverId: dto.driverId !== undefined ? dto.driverId : undefined,
                    shippingFee:
                        dto.shippingFee !== undefined
                            ? dto.shippingFee === null
                                ? null
                                : new Prisma.Decimal(dto.shippingFee)
                            : undefined,
                    note: dto.note !== undefined ? dto.note?.trim() || null : undefined,
                    version: { increment: 1 },
                },
            })
            await tx.goodsReceiptLine.update({
                where: { id: receiptLineId },
                data: {
                    productId: line.productId,
                    ownerPartyId: warehouse.legalEntity.partyId,
                    actualQty: new Prisma.Decimal(termQty.tankQty),
                    v15Qty: new Prisma.Decimal(termQty.temporaryWithdrawQty),
                    temperatureC:
                        dto.tempC !== undefined
                            ? dto.tempC === null
                                ? null
                                : new Prisma.Decimal(dto.tempC)
                            : undefined,
                    density:
                        dto.density !== undefined
                            ? dto.density === null
                                ? null
                                : new Prisma.Decimal(dto.density)
                            : undefined,
                    billQty: new Prisma.Decimal(termQty.billQty),
                    tankQty: new Prisma.Decimal(termQty.tankQty),
                    temporaryWithdrawQty: new Prisma.Decimal(termQty.temporaryWithdrawQty),
                    billToTankLossQty: new Prisma.Decimal(termQty.billToTankLossQty),
                },
            })
        })

        return this.findById(id)
    }

    async confirm(id: string) {
        const current = await this.findById(id)

        if (current.status !== GoodsReceiptStatus.DRAFT) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_NOT_IN_DRAFT')
        }

        if (!current.purchaseOrderId || !current.purchaseOrderLineId) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_ORDER_LINK_REQUIRED')
        }

        if (Number(current.qty) <= 0) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_INVALID_QTY')
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.goodsReceipt.update({
                where: { id },
                data: {
                    status: GoodsReceiptStatus.CONFIRMED,
                },
            })

            const order = await tx.purchaseOrder.findUnique({
                where: {
                    id: current.purchaseOrderId!,
                },
            })

            if (!order || order.bizType !== PurchaseBizType.TERM) {
                throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
            }

            if (order.status === PurchaseOrderStatus.APPROVED) {
                await tx.purchaseOrder.update({
                    where: {
                        id: order.id,
                    },
                    data: {
                        status: PurchaseOrderStatus.IN_PROGRESS,
                    },
                })
            }

            await this.increasePendingInventory(tx, {
                supplierLocationId: current.supplierLocationId,
                productId: current.productId,
                qty: current.qty,
                sourceId: current.id,
                occurredAt: current.receiptDate,
                note: `TERM receipt confirmed: ${current.receiptNo}`,
            })
        })

        return this.findById(id)
    }

    async void(id: string) {
        const current = await this.findById(id)

        if (current.status === GoodsReceiptStatus.VOID) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_ALREADY_VOID')
        }

        const usedInPostedRun = await this.isUsedInPostedPricing(id)

        if (usedInPostedRun) {
            throw new BadRequestException('RECEIPT_USED_IN_POSTED_PRICING_CANNOT_VOID')
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.goodsReceipt.update({
                where: { id },
                data: {
                    status: GoodsReceiptStatus.VOID,
                },
            })

            if (current.status === GoodsReceiptStatus.CONFIRMED && current.purchaseOrderLineId) {
                await this.decreasePendingInventory(tx, {
                    supplierLocationId: current.supplierLocationId,
                    productId: current.productId,
                    qty: current.qty,
                    sourceId: current.id,
                    occurredAt: new Date(),
                    note: `TERM receipt void: ${current.receiptNo}`,
                })
            }
        })

        return this.findById(id)
    }

    private async isUsedInPostedPricing(goodsReceiptId: string) {
        return this.prisma.purchasePricingRunReceipt.findFirst({
            where: {
                goodsReceiptId,
                run: {
                    status: PricingRunStatus.POSTED,
                },
            },
            select: {
                runId: true,
            },
        })
    }

    private async increasePendingInventory(
        tx: Prisma.TransactionClient,
        args: {
            supplierLocationId: string
            productId: string
            qty: Prisma.Decimal
            sourceId: string
            occurredAt: Date
            note?: string
        },
    ) {
        const receipt = await tx.goodsReceipt.findUniqueOrThrow({
            where: { id: args.sourceId },
            select: {
                lines: {
                    orderBy: { lineNo: 'asc' },
                    take: 1,
                    select: {
                        purchaseOrderLineId: true,
                        productId: true,
                        actualQty: true,
                        v15Qty: true,
                        temperatureC: true,
                        density: true,
                    },
                },
            },
        })
        const line = receipt.lines[0]
        if (!line) throw new BadRequestException('TERM_GOODS_RECEIPT_LINE_NOT_FOUND')
        await this.receiptPosting.postSingleLineReceipt({
            tx,
            goodsReceiptId: args.sourceId,
            warehouseId: args.supplierLocationId,
            productId: line.productId,
            purchaseOrderLineId: line.purchaseOrderLineId,
            actualQty: line.actualQty,
            v15Qty: line.v15Qty,
            temperatureC: line.temperatureC,
            density: line.density,
            effectiveAt: args.occurredAt,
        })
    }

    private async decreasePendingInventory(
        tx: Prisma.TransactionClient,
        args: {
            supplierLocationId: string
            productId: string
            qty: Prisma.Decimal
            sourceId: string
            occurredAt: Date
            note?: string
        },
    ) {
        await this.receiptPosting.reverseReceipt(tx, {
            goodsReceiptId: args.sourceId,
            effectiveAt: args.occurredAt,
        })
    }
}
