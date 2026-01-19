// src/modules/purchases/goods-receipts/goods-receipts.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { GoodsReceiptStatus, InventoryLedgerSourceType, PurchaseOrderStatus, Prisma } from '@prisma/client'
import { InventoryService } from '../../inventory/inventory.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class GoodsReceiptsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly inventory: InventoryService,
    ) {}

    async create(dto: {
        supplierCustomerId: string
        supplierLocationId: string
        productId: string
        receiptNo: string
        receiptDate: string
        qty: number
        tempC?: number
        density?: number
        standardQtyV15?: number
        vehicleId?: string
        driverId?: string
        shippingFee?: number
        purchaseOrderId?: string
        purchaseOrderLineId?: string
    }) {
        return this.prisma.goodsReceipt.create({
            data: {
                supplierCustomerId: dto.supplierCustomerId,
                supplierLocationId: dto.supplierLocationId,
                productId: dto.productId,
                receiptNo: dto.receiptNo,
                receiptDate: new Date(dto.receiptDate),
                qty: new Prisma.Decimal(dto.qty),

                tempC: dto.tempC == null ? null : new Prisma.Decimal(dto.tempC),
                density: dto.density == null ? null : new Prisma.Decimal(dto.density),
                standardQtyV15: dto.standardQtyV15 == null ? null : new Prisma.Decimal(dto.standardQtyV15),

                vehicleId: dto.vehicleId ?? null,
                driverId: dto.driverId ?? null,
                shippingFee: dto.shippingFee == null ? new Prisma.Decimal(0) : new Prisma.Decimal(dto.shippingFee),

                purchaseOrderId: dto.purchaseOrderId ?? null,
                purchaseOrderLineId: dto.purchaseOrderLineId ?? null,

                status: GoodsReceiptStatus.DRAFT,
            },
        })
    }

    async confirm(id: string, payload?: { note?: string }) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const gr = await tx.goodsReceipt.findUnique({
                    where: { id },
                    include: {
                        purchaseOrder: { include: { lines: true } },
                        purchaseOrderLine: true,
                        supplierLocation: true,
                    },
                })
                if (!gr) throw new NotFoundException('GR_NOT_FOUND')
                if (gr.status !== GoodsReceiptStatus.DRAFT) {
                    throw new BadRequestException('GR_NOT_DRAFT')
                }

                if (gr.supplierLocation.supplierCustomerId !== gr.supplierCustomerId) {
                    throw new BadRequestException('GR_LOCATION_NOT_BELONG_SUPPLIER')
                }

                if (gr.purchaseOrderLineId) {
                    const pol = gr.purchaseOrderLine
                    const po = gr.purchaseOrder

                    if (!pol || !po) throw new BadRequestException('GR_INVALID_PO_LINK')

                    if (![PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.IN_PROGRESS].includes(po.status as any)) {
                        throw new BadRequestException('PO_NOT_APPROVED')
                    }

                    if (pol.purchaseOrderId !== po.id) throw new BadRequestException('GR_INVALID_PO_LINE')

                    const orderedQty = new Prisma.Decimal(pol.orderedQty)
                    const withdrawnQty = new Prisma.Decimal(pol.withdrawnQty ?? 0)
                    const grQty = new Prisma.Decimal(gr.qty)

                    if (withdrawnQty.plus(grQty).greaterThan(orderedQty)) {
                        throw new BadRequestException('PO_LINE_QTY_EXCEEDED')
                    }
                }

                const confirmed = await tx.goodsReceipt.update({
                    where: { id: gr.id },
                    data: {
                        status: GoodsReceiptStatus.CONFIRMED,
                    },
                })

                await this.inventory.applyDeltaAndAppendLedger({
                    tx,
                    supplierLocationId: gr.supplierLocationId,
                    productId: gr.productId,
                    delta: { deltaPendingDocQty: gr.qty },
                    sourceType: InventoryLedgerSourceType.GOODS_RECEIPT,
                    sourceId: gr.id,
                    occurredAt: gr.receiptDate,
                    note: payload?.note ?? null,
                })

                if (gr.purchaseOrderLineId) {
                    const poLine = await tx.purchaseOrderLine.update({
                        where: { id: gr.purchaseOrderLineId },
                        data: {
                            withdrawnQty: { increment: gr.qty },
                        },
                    })

                    if (gr.purchaseOrderId) {
                        const po = await tx.purchaseOrder.findUnique({
                            where: { id: gr.purchaseOrderId },
                            include: { lines: true },
                        })
                        if (po) {
                            const allDone = po.lines.every((l) => new Prisma.Decimal(l.withdrawnQty ?? 0).greaterThanOrEqualTo(new Prisma.Decimal(l.orderedQty)))

                            await tx.purchaseOrder.update({
                                where: { id: po.id },
                                data: {
                                    status: allDone ? PurchaseOrderStatus.COMPLETED : PurchaseOrderStatus.IN_PROGRESS,
                                },
                            })
                        }
                    }

                    void poLine
                }

                return confirmed
            })
        } catch (e: any) {
            if (e?.code === 'INVENTORY_NEGATIVE_PENDING') {
                throw new BadRequestException('INVENTORY_NEGATIVE_PENDING')
            }
            if (e?.code === 'INVENTORY_NEGATIVE_POSTED') {
                throw new BadRequestException('INVENTORY_NEGATIVE_POSTED')
            }
            throw e
        }
    }
}
