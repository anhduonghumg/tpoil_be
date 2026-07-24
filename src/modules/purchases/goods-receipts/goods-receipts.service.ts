import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    GoodsReceiptStatus,
    MasterStatus,
    PurchaseOrderStatus,
    PurchaseOrderType,
    WarehousePartyRole,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateGoodsReceiptAutoConfirmDto, ListGoodsReceiptsQueryDto } from './dto/create-goods-receipt.dto'
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'

@Injectable()
export class GoodsReceiptsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly receiptPosting: GoodsReceiptPostingService,
    ) {}

    private toDateOrThrow(value: string, code: string) {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) throw new BadRequestException(code)
        return d
    }

    private readonly receiptInclude = Prisma.validator<Prisma.GoodsReceiptInclude>()({
        warehouse: { select: { id: true, code: true, name: true } },
        lines: {
            orderBy: { lineNo: 'asc' },
            include: { product: { select: { id: true, code: true, name: true, uom: true } } },
        },
    })

    private mapReceipt(receipt: any) {
        const line = receipt.lines?.[0] ?? null
        return {
            ...receipt,
            supplierLocationId: receipt.warehouseId,
            supplierLocation: receipt.warehouse,
            purchaseOrderLineId: line?.purchaseOrderLineId ?? null,
            productId: line?.productId ?? null,
            product: line?.product ?? null,
            qty: line?.actualQty ?? null,
            standardQtyV15: line?.v15Qty ?? null,
            tempC: line?.temperatureC ?? null,
            density: line?.density ?? null,
        }
    }

    private async assertLocationBelongsToSupplier(args: { supplierCustomerId: string; supplierLocationId: string }) {
        const row = await this.prisma.warehouse.findFirst({
            where: {
                id: args.supplierLocationId,
                status: MasterStatus.ACTIVE,
                parties: {
                    some: {
                        partyId: args.supplierCustomerId,
                        role: WarehousePartyRole.OPERATOR,
                        validTo: null,
                    },
                },
            },
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
                include: this.receiptInclude,
            }),
            this.prisma.goodsReceipt.count({ where }),
        ])

        return { items: items.map((item) => this.mapReceipt(item)), total, page, limit }
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
        if (po.orderType === PurchaseOrderType.LOT) {
            throw new BadRequestException({
                code: 'LOT_MUST_USE_WITHDRAWAL_FLOW',
                message: 'Đơn mua lô phải nhận hàng qua phiếu rút lô.',
            })
        }
        if (po.status !== PurchaseOrderStatus.APPROVED && po.status !== PurchaseOrderStatus.IN_PROGRESS) {
            throw new BadRequestException('PO_NOT_APPROVED')
        }

        const line = po.lines.find((x) => x.id === dto.purchaseOrderLineId)
        if (!line) throw new BadRequestException('PO_LINE_NOT_FOUND')

        const resolvedLocId = dto.supplierLocationId ?? line.receivingWarehouseId
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
                    warehouseId: resolvedLocId,
                    receiptNo,
                    receiptDate,

                    vehicleId: dto.vehicleId ?? null,
                    driverId: dto.driverId ?? null,
                    shippingFee: dto.shippingFee == null ? new Prisma.Decimal(0) : new Prisma.Decimal(dto.shippingFee),

                    status: GoodsReceiptStatus.CONFIRMED,

                    purchaseOrderId: po.id,
                },
            })

            await this.receiptPosting.postSingleLineReceipt({
                tx,
                goodsReceiptId: receipt.id,
                warehouseId: resolvedLocId,
                productId,
                purchaseOrderLineId: line.id,
                actualQty: qty,
                v15Qty: dto.standardQtyV15,
                temperatureC: dto.tempC,
                density: dto.density,
                effectiveAt: receiptDate,
            })

            if (po.status === PurchaseOrderStatus.APPROVED) {
                await tx.purchaseOrder.update({
                    where: { id: po.id },
                    data: { status: PurchaseOrderStatus.IN_PROGRESS },
                })
            }

            return tx.goodsReceipt.findUniqueOrThrow({
                where: { id: receipt.id },
                include: this.receiptInclude,
            })
        })

        return { receipt: this.mapReceipt(result) }
    }
}
