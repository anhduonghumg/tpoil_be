import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    CommercialLotWithdrawalStatus,
    GoodsReceiptStatus,
    MasterStatus,
    PayableOpenItemStatus,
    Prisma,
    PurchaseOrderStatus,
    PurchaseOrderType,
    SupplierInvoiceStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'
import {
    CreateCommercialLotWithdrawalDto,
    ListCommercialLotsQueryDto,
} from './dto/commercial-lot.dto'

const detailInclude = Prisma.validator<Prisma.PurchaseOrderInclude>()({
    supplier: { select: { id: true, code: true, name: true, taxCode: true } },
    contract: { select: { id: true, code: true, name: true, startDate: true, endDate: true } },
    lines: {
        orderBy: { lineNo: 'asc' },
        include: {
            product: { select: { id: true, code: true, name: true, uom: true } },
            receivingWarehouse: { select: { id: true, code: true, name: true } },
            commercialLotPosition: true,
        },
    },
    supplierInvoices: {
        where: { status: { not: SupplierInvoiceStatus.VOIDED } },
        orderBy: { invoiceDate: 'asc' },
        include: {
            openItem: true,
            lines: {
                select: {
                    id: true,
                    purchaseOrderLineId: true,
                    actualQty: true,
                    netAmount: true,
                    taxAmount: true,
                },
            },
        },
    },
    commercialLotWithdrawals: {
        orderBy: [{ withdrawalDate: 'desc' }, { createdAt: 'desc' }],
        include: {
            destinationWarehouse: { select: { id: true, code: true, name: true } },
            lines: {
                orderBy: { lineNo: 'asc' },
                include: {
                    commercialLotPosition: {
                        include: {
                            product: { select: { id: true, code: true, name: true, uom: true } },
                        },
                    },
                },
            },
        },
    },
})

@Injectable()
export class CommercialLotsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly receiptPosting: GoodsReceiptPostingService,
    ) {}

    private quantityTotals(order: any) {
        const orderedQty = (order.lines ?? []).reduce(
            (sum: number, line: any) => sum + Number(line.orderedQty ?? 0),
            0,
        )
        const invoicedQty = (order.lines ?? []).reduce(
            (sum: number, line: any) => sum + Number(line.commercialLotPosition?.invoicedQty ?? 0),
            0,
        )
        const withdrawnQty = (order.lines ?? []).reduce(
            (sum: number, line: any) => sum + Number(line.commercialLotPosition?.withdrawnQty ?? 0),
            0,
        )
        const accountingValue = (order.lines ?? []).reduce(
            (sum: number, line: any) => sum + Number(line.commercialLotPosition?.accountingValue ?? 0),
            0,
        )
        return {
            orderedQty,
            invoicedQty,
            withdrawnQty,
            remainingToWithdraw: Math.max(invoicedQty - withdrawnQty, 0),
            accountingValue,
        }
    }

    private paymentTotals(order: any) {
        const postedInvoices = (order.supplierInvoices ?? []).filter(
            (invoice: any) => invoice.status === SupplierInvoiceStatus.POSTED,
        )
        const payableAmount = postedInvoices.reduce(
            (sum: number, invoice: any) =>
                sum + Number(invoice.openItem?.originalAmount ?? invoice.totalAmount ?? 0),
            0,
        )
        const outstandingAmount = postedInvoices.reduce(
            (sum: number, invoice: any) =>
                sum + Number(invoice.openItem?.outstandingAmount ?? invoice.totalAmount ?? 0),
            0,
        )
        return {
            payableAmount,
            paidAmount: Math.max(payableAmount - outstandingAmount, 0),
            outstandingAmount,
            isPaid:
                postedInvoices.length > 0 &&
                postedInvoices.every(
                    (invoice: any) => invoice.openItem?.status === PayableOpenItemStatus.SETTLED,
                ),
        }
    }

    private lifecycle(order: any) {
        if (order.status === PurchaseOrderStatus.CANCELLED) return 'CANCELLED'
        if (order.status === PurchaseOrderStatus.DRAFT) return 'PENDING_APPROVAL'

        const postedInvoices = (order.supplierInvoices ?? []).filter(
            (invoice: any) => invoice.status === SupplierInvoiceStatus.POSTED,
        )
        if (!postedInvoices.length) return 'PENDING_INVOICE'
        const payment = this.paymentTotals(order)
        if (!payment.isPaid) return 'PENDING_PAYMENT'

        const totals = this.quantityTotals(order)
        if (totals.remainingToWithdraw <= 0 && totals.invoicedQty >= totals.orderedQty) return 'COMPLETED'
        if (totals.withdrawnQty > 0) return 'WITHDRAWING'
        return 'READY_TO_WITHDRAW'
    }

    private mapOrder(order: any) {
        return {
            ...order,
            lifecycle: this.lifecycle(order),
            quantities: this.quantityTotals(order),
            payment: this.paymentTotals(order),
        }
    }

    async list(query: ListCommercialLotsQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const where: Prisma.PurchaseOrderWhereInput = {
            orderType: PurchaseOrderType.LOT,
            bizType: 'COMMERCIAL',
            supplierCustomerId: query.supplierCustomerId ?? undefined,
            orderDate: {
                gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
                lte: query.dateTo ? new Date(`${query.dateTo}T23:59:59.999Z`) : undefined,
            },
            ...(query.keyword?.trim()
                ? {
                      OR: [
                          { orderNo: { contains: query.keyword.trim(), mode: 'insensitive' } },
                          { supplier: { name: { contains: query.keyword.trim(), mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        if (query.lifecycle) {
            const rows = await this.prisma.purchaseOrder.findMany({
                where,
                include: detailInclude,
                orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
                take: 1000,
            })
            const matching = rows
                .map((row) => this.mapOrder(row))
                .filter((item) => item.lifecycle === query.lifecycle)
            return {
                items: matching.slice((page - 1) * limit, page * limit),
                total: matching.length,
                page,
                limit,
            }
        }

        const [rows, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                include: detailInclude,
                orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.purchaseOrder.count({ where }),
        ])
        return { items: rows.map((row) => this.mapOrder(row)), total, page, limit }
    }

    async detail(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id, orderType: PurchaseOrderType.LOT, bizType: 'COMMERCIAL' },
            include: detailInclude,
        })
        if (!order) throw new NotFoundException('COMMERCIAL_LOT_PURCHASE_NOT_FOUND')
        return this.mapOrder(order)
    }

    async createWithdrawal(
        purchaseOrderId: string,
        dto: CreateCommercialLotWithdrawalDto,
        actorId?: string | null,
    ) {
        const withdrawalNo = dto.withdrawalNo.trim()
        if (!withdrawalNo) throw new BadRequestException('WITHDRAWAL_NO_REQUIRED')
        if (new Set(dto.lines.map((line) => line.commercialLotPositionId)).size !== dto.lines.length) {
            throw new BadRequestException('WITHDRAWAL_POSITION_DUPLICATED')
        }

        const id = await this.prisma.$transaction(async (tx) => {
            const order = await tx.purchaseOrder.findFirst({
                where: {
                    id: purchaseOrderId,
                    orderType: PurchaseOrderType.LOT,
                    bizType: 'COMMERCIAL',
                    status: { in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.IN_PROGRESS] },
                },
                include: {
                    supplierInvoices: {
                        where: { status: SupplierInvoiceStatus.POSTED },
                        include: { openItem: true },
                    },
                },
            })
            if (!order) throw new BadRequestException('COMMERCIAL_LOT_PURCHASE_NOT_WITHDRAWABLE')
            if (!order.supplierInvoices.length) throw new BadRequestException('POSTED_SUPPLIER_INVOICE_REQUIRED')
            if (
                order.supplierInvoices.some(
                    (invoice) => invoice.openItem?.status !== PayableOpenItemStatus.SETTLED,
                )
            ) {
                throw new BadRequestException({
                    code: 'LOT_PAYMENT_REQUIRED_BEFORE_WITHDRAWAL',
                    message: 'Đơn lô phải hoàn tất thanh toán trước khi xác nhận rút hàng.',
                })
            }

            const warehouse = await tx.warehouse.findFirst({
                where: {
                    id: dto.destinationWarehouseId,
                    legalEntityId: order.legalEntityId,
                    status: MasterStatus.ACTIVE,
                },
                select: { id: true },
            })
            if (!warehouse) throw new BadRequestException('DESTINATION_WAREHOUSE_INVALID')

            const positionIds = dto.lines.map((line) => line.commercialLotPositionId)
            const positions = await tx.commercialLotPosition.findMany({
                where: {
                    id: { in: positionIds },
                    purchaseOrderLine: { purchaseOrderId: order.id },
                },
            })
            if (positions.length !== positionIds.length) {
                throw new BadRequestException('WITHDRAWAL_POSITION_INVALID')
            }
            const positionMap = new Map(positions.map((position) => [position.id, position]))
            const activeDrafts = await tx.commercialLotWithdrawalLine.groupBy({
                by: ['commercialLotPositionId'],
                where: {
                    commercialLotPositionId: { in: positionIds },
                    withdrawal: {
                        purchaseOrderId: order.id,
                        status: CommercialLotWithdrawalStatus.DRAFT,
                    },
                },
                _sum: { actualQty: true },
            })
            const draftQtyMap = new Map(
                activeDrafts.map((row) => [
                    row.commercialLotPositionId,
                    row._sum.actualQty ?? new Prisma.Decimal(0),
                ]),
            )
            for (const line of dto.lines) {
                const position = positionMap.get(line.commercialLotPositionId)!
                const available = position.invoicedQty
                    .minus(position.withdrawnQty)
                    .minus(draftQtyMap.get(position.id) ?? 0)
                if (new Prisma.Decimal(line.actualQty).greaterThan(available)) {
                    throw new BadRequestException({
                        code: 'WITHDRAWAL_QTY_EXCEEDS_INVOICED_BALANCE',
                        message: 'Số lượng rút vượt quá lượng hóa đơn còn lại.',
                        commercialLotPositionId: position.id,
                        availableQty: available.toString(),
                    })
                }
            }

            const withdrawal = await tx.commercialLotWithdrawal.create({
                data: {
                    purchaseOrderId: order.id,
                    withdrawalNo,
                    destinationWarehouseId: warehouse.id,
                    withdrawalDate: new Date(dto.withdrawalDate),
                    note: dto.note?.trim() || null,
                    createdById: actorId ?? null,
                    lines: {
                        create: dto.lines.map((line, index) => ({
                            lineNo: index + 1,
                            commercialLotPositionId: line.commercialLotPositionId,
                            actualQty: new Prisma.Decimal(line.actualQty),
                            v15Qty: line.v15Qty == null ? null : new Prisma.Decimal(line.v15Qty),
                            temperatureC:
                                line.temperatureC == null ? null : new Prisma.Decimal(line.temperatureC),
                            density: line.density == null ? null : new Prisma.Decimal(line.density),
                        })),
                    },
                },
                select: { id: true },
            })
            return withdrawal.id
        })
        return this.detailWithdrawal(id)
    }

    private async detailWithdrawal(id: string) {
        const withdrawal = await this.prisma.commercialLotWithdrawal.findUnique({
            where: { id },
            include: {
                destinationWarehouse: { select: { id: true, code: true, name: true } },
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        commercialLotPosition: {
                            include: {
                                product: { select: { id: true, code: true, name: true, uom: true } },
                            },
                        },
                    },
                },
            },
        })
        if (!withdrawal) throw new NotFoundException('LOT_WITHDRAWAL_NOT_FOUND')
        return withdrawal
    }

    async confirmWithdrawal(
        purchaseOrderId: string,
        withdrawalId: string,
        actorId?: string | null,
    ) {
        await this.prisma.$transaction(async (tx) => {
            const withdrawal = await tx.commercialLotWithdrawal.findFirst({
                where: {
                    id: withdrawalId,
                    purchaseOrderId,
                    status: CommercialLotWithdrawalStatus.DRAFT,
                },
                include: {
                    purchaseOrder: true,
                    lines: {
                        include: {
                            commercialLotPosition: {
                                include: { purchaseOrderLine: true },
                            },
                        },
                    },
                },
            })
            if (!withdrawal) throw new BadRequestException('LOT_WITHDRAWAL_NOT_DRAFT')
            const now = new Date()

            for (const line of withdrawal.lines) {
                const position = line.commercialLotPosition
                const available = position.invoicedQty.minus(position.withdrawnQty)
                if (line.actualQty.greaterThan(available)) {
                    throw new BadRequestException('WITHDRAWAL_QTY_EXCEEDS_INVOICED_BALANCE')
                }
                const receiptNo = `${withdrawal.purchaseOrder.orderNo}-${withdrawal.withdrawalNo}-${line.lineNo}`
                const receipt = await tx.goodsReceipt.create({
                    data: {
                        receiptNo,
                        supplierCustomerId: position.supplierCustomerId,
                        warehouseId: withdrawal.destinationWarehouseId,
                        receiptDate: withdrawal.withdrawalDate,
                        status: GoodsReceiptStatus.CONFIRMED,
                        purchaseOrderId: withdrawal.purchaseOrderId,
                        note: `Rút lô ${withdrawal.withdrawalNo}`,
                    },
                })
                await this.receiptPosting.postSingleLineReceipt({
                    tx,
                    goodsReceiptId: receipt.id,
                    warehouseId: withdrawal.destinationWarehouseId,
                    productId: position.productId,
                    purchaseOrderLineId: position.purchaseOrderLineId,
                    actualQty: line.actualQty,
                    v15Qty: line.v15Qty,
                    temperatureC: line.temperatureC,
                    density: line.density,
                    effectiveAt: withdrawal.withdrawalDate,
                    actorId,
                })
                await this.receiptPosting.releasePendingForInvoice(tx, {
                    goodsReceiptId: receipt.id,
                    occurredAt: withdrawal.withdrawalDate,
                    actorId,
                })
                await tx.commercialLotWithdrawalLine.update({
                    where: { id: line.id },
                    data: { goodsReceiptId: receipt.id },
                })
                await tx.commercialLotPosition.update({
                    where: { id: position.id },
                    data: {
                        withdrawnQty: { increment: line.actualQty },
                        version: { increment: 1 },
                    },
                })
            }

            await tx.commercialLotWithdrawal.update({
                where: { id: withdrawal.id },
                data: {
                    status: CommercialLotWithdrawalStatus.CONFIRMED,
                    confirmedById: actorId ?? null,
                    confirmedAt: now,
                    version: { increment: 1 },
                },
            })

            const positions = await tx.commercialLotPosition.findMany({
                where: { purchaseOrderLine: { purchaseOrderId } },
                include: { purchaseOrderLine: { select: { orderedQty: true } } },
            })
            const completed =
                positions.length > 0 &&
                positions.every(
                    (position) =>
                        position.invoicedQty.greaterThanOrEqualTo(position.purchaseOrderLine.orderedQty) &&
                        position.withdrawnQty.greaterThanOrEqualTo(position.invoicedQty),
                )
            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: {
                    status: completed ? PurchaseOrderStatus.COMPLETED : PurchaseOrderStatus.IN_PROGRESS,
                    version: { increment: 1 },
                },
            })
        })
        return this.detail(purchaseOrderId)
    }

    async cancelWithdrawal(purchaseOrderId: string, withdrawalId: string) {
        const result = await this.prisma.commercialLotWithdrawal.updateMany({
            where: {
                id: withdrawalId,
                purchaseOrderId,
                status: CommercialLotWithdrawalStatus.DRAFT,
            },
            data: {
                status: CommercialLotWithdrawalStatus.CANCELLED,
                version: { increment: 1 },
            },
        })
        if (result.count !== 1) throw new BadRequestException('LOT_WITHDRAWAL_NOT_DRAFT')
        return this.detail(purchaseOrderId)
    }
}
