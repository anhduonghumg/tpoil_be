import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { GoodsReceiptStatus, InventoryLedgerSourceType, PricingRunStatus, Prisma, PurchaseBizType, PurchaseOrderStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateTermGoodsReceiptDto } from './dto/create-term-goods-receipt.dto'
import { UpdateTermGoodsReceiptDto } from './dto/update-term-goods-receipt.dto'

@Injectable()
export class PurchaseTermReceiptsService {
    constructor(private readonly prisma: PrismaService) {}

    private toDateOnly(value?: string | Date | null): Date | undefined {
        if (!value) return undefined
        if (value instanceof Date) return value
        return new Date(`${value}T00:00:00.000Z`)
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

    private receiptInclude = {
        supplier: true,
        supplierLocation: true,
        product: true,
        purchaseOrder: true,
        purchaseOrderLine: {
            include: {
                product: true,
                supplierLocation: true,
            },
        },
    }

    async create(orderId: string, dto: CreateTermGoodsReceiptDto) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: {
                id: orderId,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                lines: {
                    include: {
                        product: true,
                        supplierLocation: true,
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

        const supplierLocationId = dto.supplierLocationId || line.supplierLocationId || order.supplierLocationId

        if (!supplierLocationId) {
            throw new BadRequestException('SUPPLIER_LOCATION_REQUIRED')
        }

        if (line.supplierLocationId && supplierLocationId !== line.supplierLocationId) {
            throw new BadRequestException('RECEIPT_LOCATION_NOT_MATCH_ORDER_LINE')
        }

        if (Number(dto.qty) <= 0) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_INVALID_QTY')
        }

        const receipt = await this.prisma.$transaction(async (tx) => {
            const receiptNo = await this.generateReceiptNo(tx)

            return tx.goodsReceipt.create({
                data: {
                    receiptNo,
                    supplierCustomerId: order.supplierCustomerId,
                    supplierLocationId,
                    productId: line.productId,
                    receiptDate: this.toDateOnly(dto.receiptDate)!,
                    qty: new Prisma.Decimal(dto.qty),
                    tempC: dto.tempC !== undefined && dto.tempC !== null ? new Prisma.Decimal(dto.tempC) : null,
                    density: dto.density !== undefined && dto.density !== null ? new Prisma.Decimal(dto.density) : null,
                    standardQtyV15: dto.standardQtyV15 !== undefined && dto.standardQtyV15 !== null ? new Prisma.Decimal(dto.standardQtyV15) : null,
                    vehicleId: dto.vehicleId ?? null,
                    driverId: dto.driverId ?? null,
                    shippingFee: dto.shippingFee !== undefined && dto.shippingFee !== null ? new Prisma.Decimal(dto.shippingFee) : new Prisma.Decimal(0),
                    status: GoodsReceiptStatus.DRAFT,
                    purchaseOrderId: order.id,
                    purchaseOrderLineId: line.id,
                },
                include: this.receiptInclude,
            })
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
                purchaseOrderLine: {
                    include: {
                        product: true,
                        supplierLocation: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
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
            include: this.receiptInclude,
        })

        if (!receipt) {
            throw new NotFoundException('TERM_GOODS_RECEIPT_NOT_FOUND')
        }

        return receipt
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

        if (line.supplierLocationId && supplierLocationId !== line.supplierLocationId) {
            throw new BadRequestException('RECEIPT_LOCATION_NOT_MATCH_ORDER_LINE')
        }

        if (dto.productId && dto.productId !== line.productId) {
            throw new BadRequestException('RECEIPT_PRODUCT_NOT_MATCH_ORDER_LINE')
        }

        if (dto.qty !== undefined && Number(dto.qty) <= 0) {
            throw new BadRequestException('TERM_GOODS_RECEIPT_INVALID_QTY')
        }

        await this.prisma.goodsReceipt.update({
            where: { id },
            data: {
                supplierLocationId,
                productId: line.productId,
                receiptDate: dto.receiptDate !== undefined ? this.toDateOnly(dto.receiptDate) : undefined,
                qty: dto.qty !== undefined && dto.qty !== null ? new Prisma.Decimal(dto.qty) : undefined,
                tempC: dto.tempC !== undefined ? (dto.tempC === null ? null : new Prisma.Decimal(dto.tempC)) : undefined,
                density: dto.density !== undefined ? (dto.density === null ? null : new Prisma.Decimal(dto.density)) : undefined,
                standardQtyV15: dto.standardQtyV15 !== undefined ? (dto.standardQtyV15 === null ? null : new Prisma.Decimal(dto.standardQtyV15)) : undefined,
                vehicleId: dto.vehicleId !== undefined ? dto.vehicleId : undefined,
                driverId: dto.driverId !== undefined ? dto.driverId : undefined,
                shippingFee: dto.shippingFee !== undefined ? (dto.shippingFee === null ? null : new Prisma.Decimal(dto.shippingFee)) : undefined,
            },
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

            await tx.purchaseOrderLine.update({
                where: {
                    id: current.purchaseOrderLineId!,
                },
                data: {
                    withdrawnQty: {
                        increment: current.qty,
                    },
                },
            })

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
                await tx.purchaseOrderLine.update({
                    where: {
                        id: current.purchaseOrderLineId,
                    },
                    data: {
                        withdrawnQty: {
                            decrement: current.qty,
                        },
                    },
                })

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
        const balance = await tx.inventoryBalance.upsert({
            where: {
                supplierLocationId_productId: {
                    supplierLocationId: args.supplierLocationId,
                    productId: args.productId,
                },
            },
            create: {
                supplierLocationId: args.supplierLocationId,
                productId: args.productId,
                physicalQty: args.qty,
                pendingDocQty: args.qty,
                postedQty: new Prisma.Decimal(0),
            },
            update: {
                physicalQty: {
                    increment: args.qty,
                },
                pendingDocQty: {
                    increment: args.qty,
                },
            },
        })

        await tx.inventoryLedger.create({
            data: {
                supplierLocationId: args.supplierLocationId,
                productId: args.productId,
                deltaPhysicalQty: args.qty,
                deltaPendingDocQty: args.qty,
                deltaPostedQty: new Prisma.Decimal(0),
                afterPhysicalQty: balance.physicalQty,
                afterPendingDocQty: balance.pendingDocQty,
                afterPostedQty: balance.postedQty,
                sourceType: InventoryLedgerSourceType.GOODS_RECEIPT,
                sourceId: args.sourceId,
                occurredAt: args.occurredAt,
                note: args.note ?? null,
            },
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
        const current = await tx.inventoryBalance.findUnique({
            where: {
                supplierLocationId_productId: {
                    supplierLocationId: args.supplierLocationId,
                    productId: args.productId,
                },
            },
        })

        if (!current) {
            throw new BadRequestException('INVENTORY_BALANCE_NOT_FOUND')
        }

        const nextPhysicalQty = new Prisma.Decimal(current.physicalQty).minus(args.qty)
        const nextPendingDocQty = new Prisma.Decimal(current.pendingDocQty).minus(args.qty)

        if (nextPhysicalQty.lt(0) || nextPendingDocQty.lt(0)) {
            throw new BadRequestException('INVENTORY_BALANCE_NOT_ENOUGH_TO_VOID_RECEIPT')
        }

        const balance = await tx.inventoryBalance.update({
            where: {
                supplierLocationId_productId: {
                    supplierLocationId: args.supplierLocationId,
                    productId: args.productId,
                },
            },
            data: {
                physicalQty: nextPhysicalQty,
                pendingDocQty: nextPendingDocQty,
            },
        })

        await tx.inventoryLedger.create({
            data: {
                supplierLocationId: args.supplierLocationId,
                productId: args.productId,
                deltaPhysicalQty: args.qty.negated(),
                deltaPendingDocQty: args.qty.negated(),
                deltaPostedQty: new Prisma.Decimal(0),
                afterPhysicalQty: balance.physicalQty,
                afterPendingDocQty: balance.pendingDocQty,
                afterPostedQty: balance.postedQty,
                sourceType: InventoryLedgerSourceType.GOODS_RECEIPT,
                sourceId: args.sourceId,
                occurredAt: args.occurredAt,
                note: args.note ?? null,
            },
        })
    }
}
