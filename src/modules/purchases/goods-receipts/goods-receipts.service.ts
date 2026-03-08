import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, GoodsReceiptStatus, PurchaseOrderStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateGoodsReceiptAutoConfirmDto, ListGoodsReceiptsQueryDto } from './dto/create-goods-receipt.dto'

@Injectable()
export class GoodsReceiptsService {
    constructor(private readonly prisma: PrismaService) {}

    private toDateOrThrow(value: string, code: string) {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) throw new BadRequestException(code)
        return d
    }

    private async assertLocationBelongsToSupplier(args: { supplierCustomerId: string; supplierLocationId: string }) {
        const row = await this.prisma.supplierLocation.findFirst({
            where: { id: args.supplierLocationId, supplierCustomerId: args.supplierCustomerId, isActive: true },
            select: { id: true },
        })
        if (!row) {
            throw new BadRequestException({
                code: 'SUPPLIER_LOCATION_INVALID',
                message: 'Kho NCC không hợp lệ hoặc không thuộc NCC đã chọn.',
                supplierLocationId: args.supplierLocationId,
            })
        }
    }

    async list(q: ListGoodsReceiptsQueryDto) {
        const page = Math.max(1, q.page ?? 1)
        const limit = Math.min(200, Math.max(1, q.limit ?? 20))
        const skip = (page - 1) * limit

        const where: Prisma.GoodsReceiptWhereInput = {
            purchaseOrderId: q.purchaseOrderId ?? undefined,
            supplierCustomerId: q.supplierCustomerId ?? undefined,
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.goodsReceipt.findMany({
                where,
                orderBy: { receiptDate: 'desc' },
                skip,
                take: limit,
                include: {
                    supplierLocation: { select: { id: true, code: true, name: true } },
                    product: { select: { id: true, code: true, name: true, uom: true } },
                },
            }),
            this.prisma.goodsReceipt.count({ where }),
        ])

        return { items, total, page, limit }
    }

    async createAutoConfirm(dto: CreateGoodsReceiptAutoConfirmDto) {
        const receiptNo = (dto.receiptNo ?? '').trim()
        if (!receiptNo) throw new BadRequestException('RECEIPT_NO_REQUIRED')

        const receiptDate = this.toDateOrThrow(dto.receiptDate, 'RECEIPT_DATE_INVALID')
        const qty = Number(dto.qty) || 0
        if (qty <= 0) throw new BadRequestException('QTY_INVALID')

        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id: dto.purchaseOrderId },
            include: { lines: true },
        })

        if (!po) throw new NotFoundException('PO_NOT_FOUND')
        if (po.status !== PurchaseOrderStatus.APPROVED && po.status !== PurchaseOrderStatus.IN_PROGRESS) {
            throw new BadRequestException('PO_NOT_APPROVED')
        }

        const line = po.lines.find((x) => x.id === dto.purchaseOrderLineId)
        if (!line) throw new BadRequestException('PO_LINE_NOT_FOUND')

        const headerLocId = po.supplierLocationId ?? null
        const resolvedLocId = dto.supplierLocationId ?? line.supplierLocationId ?? headerLocId
        if (!resolvedLocId) {
            throw new BadRequestException({
                code: 'SUPPLIER_LOCATION_REQUIRED',
                message: 'Phiếu nhận hàng phải có kho nhận (từ dòng hàng / hoặc kho mặc định ở đầu PO).',
            })
        }

        await this.assertLocationBelongsToSupplier({
            supplierCustomerId: po.supplierCustomerId,
            supplierLocationId: resolvedLocId,
        })

        const productId = line.productId

        const result = await this.prisma.$transaction(async (tx) => {
            const receipt = await tx.goodsReceipt.create({
                data: {
                    supplierCustomerId: po.supplierCustomerId,
                    supplierLocationId: resolvedLocId,
                    productId,
                    receiptNo,
                    receiptDate,
                    qty: new Prisma.Decimal(qty),

                    tempC: dto.tempC == null ? null : new Prisma.Decimal(dto.tempC),
                    density: dto.density == null ? null : new Prisma.Decimal(dto.density),
                    standardQtyV15: dto.standardQtyV15 == null ? null : new Prisma.Decimal(dto.standardQtyV15),

                    vehicleId: dto.vehicleId ?? null,
                    driverId: dto.driverId ?? null,
                    shippingFee: dto.shippingFee == null ? new Prisma.Decimal(0) : new Prisma.Decimal(dto.shippingFee),

                    status: GoodsReceiptStatus.CONFIRMED,

                    purchaseOrderId: po.id,
                    purchaseOrderLineId: line.id,
                },
                include: {
                    supplierLocation: { select: { id: true, code: true, name: true } },
                    product: { select: { id: true, code: true, name: true, uom: true } },
                },
            })

            await tx.inventoryBalance.upsert({
                where: { supplierLocationId_productId: { supplierLocationId: resolvedLocId, productId } },
                create: {
                    supplierLocationId: resolvedLocId,
                    productId,
                    physicalQty: new Prisma.Decimal(0),
                    pendingDocQty: new Prisma.Decimal(0),
                    postedQty: new Prisma.Decimal(0),
                },
                update: {},
            })

            await tx.inventoryBalance.update({
                where: { supplierLocationId_productId: { supplierLocationId: resolvedLocId, productId } },
                data: {
                    physicalQty: { increment: new Prisma.Decimal(qty) },
                    pendingDocQty: { increment: new Prisma.Decimal(qty) },
                },
            })

            const bal = await tx.inventoryBalance.findUnique({
                where: { supplierLocationId_productId: { supplierLocationId: resolvedLocId, productId } },
                select: { physicalQty: true, pendingDocQty: true, postedQty: true },
            })
            if (!bal) throw new BadRequestException('INVENTORY_BALANCE_NOT_FOUND')

            await tx.inventoryLedger.create({
                data: {
                    supplierLocationId: resolvedLocId,
                    productId,

                    deltaPhysicalQty: new Prisma.Decimal(qty),
                    deltaPendingDocQty: new Prisma.Decimal(qty),
                    deltaPostedQty: new Prisma.Decimal(0),

                    afterPhysicalQty: bal.physicalQty,
                    afterPendingDocQty: bal.pendingDocQty,
                    afterPostedQty: bal.postedQty,

                    sourceType: 'GOODS_RECEIPT',
                    sourceId: receipt.id,
                    note: `GR ${receiptNo}`,

                    occurredAt: receiptDate,
                },
            })

            await tx.purchaseOrderLine.update({
                where: { id: line.id },
                data: { withdrawnQty: { increment: new Prisma.Decimal(qty) } },
            })

            if (po.status === PurchaseOrderStatus.APPROVED) {
                await tx.purchaseOrder.update({
                    where: { id: po.id },
                    data: { status: PurchaseOrderStatus.IN_PROGRESS },
                })
            }

            return receipt
        })

        return { receipt: result }
    }
}
