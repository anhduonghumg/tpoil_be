import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { GoodsReceiptStatus, PricingRunStatus, PurchaseBizType, PurchaseOrderStatus } from '@prisma/client'
import { CreateTermGoodsReceiptDto } from './dto/create-term-goods-receipt.dto'
import { UpdateTermGoodsReceiptDto } from './dto/update-term-goods-receipt.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class PurchaseTermReceiptsService {
    constructor(private readonly prisma: PrismaService) {}

    private async generateReceiptNo(): Promise<string> {
        const now = new Date()
        const y = now.getFullYear()
        const m = String(now.getMonth() + 1).padStart(2, '0')
        const prefix = `GRTERM${y}${m}`
        const count = await this.prisma.goodsReceipt.count({ where: { receiptNo: { startsWith: prefix } } })
        return `${prefix}-${String(count + 1).padStart(4, '0')}`
    }

    async create(orderId: string, dto: CreateTermGoodsReceiptDto) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id: orderId, bizType: PurchaseBizType.TERM },
            include: { lines: true },
        })

        if (!order) throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        // if ([PurchaseOrderStatus.CANCELLED, PurchaseOrderStatus.COMPLETED].includes(order.status)) {
        //     throw new BadRequestException('TERM_PURCHASE_ORDER_NOT_AVAILABLE_FOR_RECEIPT')
        // }

        if (order.status === PurchaseOrderStatus.CANCELLED || order.status === PurchaseOrderStatus.COMPLETED) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_NOT_AVAILABLE_FOR_RECEIPT')
        }

        const line = order.lines.find((x) => x.id === dto.purchaseOrderLineId)
        if (!line) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINE_NOT_FOUND')
        }

        const receiptNo = await this.generateReceiptNo()

        const receipt = await this.prisma.goodsReceipt.create({
            data: {
                receiptNo,
                supplierCustomerId: order.supplierCustomerId,
                supplierLocationId: dto.supplierLocationId,
                productId: dto.productId,
                receiptDate: dto.receiptDate,
                qty: dto.qty,
                tempC: dto.tempC ?? null,
                density: dto.density ?? null,
                standardQtyV15: dto.standardQtyV15 ?? null,
                vehicleId: dto.vehicleId ?? null,
                driverId: dto.driverId ?? null,
                shippingFee: dto.shippingFee ?? 0,
                status: GoodsReceiptStatus.DRAFT,
                purchaseOrderId: orderId,
                purchaseOrderLineId: dto.purchaseOrderLineId,
            },
            include: {
                supplier: true,
                supplierLocation: true,
                product: true,
                purchaseOrder: true,
                purchaseOrderLine: true,
            },
        })

        return receipt
    }

    async listByOrder(orderId: string) {
        return this.prisma.goodsReceipt.findMany({
            where: {
                purchaseOrderId: orderId,
                purchaseOrder: {
                    bizType: PurchaseBizType.TERM,
                },
            },
            include: {
                product: true,
                supplierLocation: true,
            },
            orderBy: { createdAt: 'desc' },
        })
    }

    async findById(id: string) {
        const receipt = await this.prisma.goodsReceipt.findFirst({
            where: {
                id,
                purchaseOrder: {
                    bizType: PurchaseBizType.TERM,
                },
            },
            include: {
                product: true,
                supplierLocation: true,
                purchaseOrder: true,
                purchaseOrderLine: true,
            },
        })

        if (!receipt) throw new NotFoundException('TERM_GOODS_RECEIPT_NOT_FOUND')
        return receipt
    }

    // async update(id: string, dto: UpdateTermGoodsReceiptDto) {
    //     const current = await this.findById(id)
    //     if (current.status !== GoodsReceiptStatus.DRAFT) {
    //         throw new BadRequestException('TERM_GOODS_RECEIPT_NOT_IN_DRAFT')
    //     }

    //     await this.prisma.goodsReceipt.update({
    //         where: { id },
    //         data: {
    //             receiptDate: dto.receiptDate ?? undefined,
    //             qty: dto.qty ?? undefined,
    //             tempC: dto.tempC ?? undefined,
    //             density: dto.density ?? undefined,
    //             standardQtyV15: dto.standardQtyV15 ?? undefined,
    //             vehicleId: dto.vehicleId ?? undefined,
    //             driverId: dto.driverId ?? undefined,
    //             shippingFee: dto.shippingFee ?? undefined,
    //         },
    //     })

    //     return this.findById(id)
    // }

    async update(id: string, dto: UpdateTermGoodsReceiptDto) {
        const current = await this.findById(id)

        if (current.status !== GoodsReceiptStatus.DRAFT) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_NOT_IN_DRAFT')
        }

        const usedInPostedRun = await this.prisma.purchasePricingRunReceipt.findFirst({
            where: {
                goodsReceiptId: id,
                run: {
                    status: PricingRunStatus.POSTED,
                },
            },
        })

        if (usedInPostedRun) {
            throw new BadRequestException('RECEIPT_USED_IN_POSTED_PRICING_NOT_EDITABLE')
        }

        await this.prisma.goodsReceipt.update({
            where: { id },
            data: {
                receiptDate: dto.receiptDate ?? undefined,
                qty: dto.qty ?? undefined,
                tempC: dto.tempC ?? undefined,
                density: dto.density ?? undefined,
                standardQtyV15: dto.standardQtyV15 ?? undefined,
                vehicleId: dto.vehicleId ?? undefined,
                driverId: dto.driverId ?? undefined,
                shippingFee: dto.shippingFee ?? undefined,
            },
        })

        return this.findById(id)
    }

    async confirm(id: string) {
        const current = await this.findById(id)
        if (current.status !== GoodsReceiptStatus.DRAFT) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_NOT_IN_DRAFT')
        }
        if (Number(current.qty) <= 0) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_INVALID_QTY')
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.goodsReceipt.update({
                where: { id },
                data: { status: GoodsReceiptStatus.CONFIRMED },
            })

            if (current.purchaseOrderId) {
                const order = await tx.purchaseOrder.findUnique({ where: { id: current.purchaseOrderId } })
                if (order && order.status === PurchaseOrderStatus.APPROVED) {
                    await tx.purchaseOrder.update({
                        where: { id: order.id },
                        data: { status: PurchaseOrderStatus.IN_PROGRESS },
                    })
                }
            }

            if (current.purchaseOrderLineId) {
                await tx.purchaseOrderLine.update({
                    where: { id: current.purchaseOrderLineId },
                    data: {
                        withdrawnQty: {
                            increment: current.qty,
                        },
                    },
                })
            }
        })

        return this.findById(id)
    }

    async void(id: string) {
        const current = await this.findById(id)

        if (current.status === GoodsReceiptStatus.VOID) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_ALREADY_VOID')
        }

        const usedInPostedRun = await this.prisma.purchasePricingRunReceipt.findFirst({
            where: {
                goodsReceiptId: id,
                run: {
                    status: PricingRunStatus.POSTED,
                },
            },
        })

        if (usedInPostedRun) {
            throw new BadRequestException('RECEIPT_USED_IN_POSTED_PRICING_CANNOT_VOID')
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.goodsReceipt.update({
                where: { id },
                data: { status: GoodsReceiptStatus.VOID },
            })

            if (current.status === GoodsReceiptStatus.CONFIRMED && current.purchaseOrderLineId) {
                await tx.purchaseOrderLine.update({
                    where: { id: current.purchaseOrderLineId },
                    data: {
                        withdrawnQty: {
                            decrement: current.qty,
                        },
                    },
                })
            }
        })

        return this.findById(id)
    }
}
